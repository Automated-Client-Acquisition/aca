/**
 * Mirrors supabase/functions/_shared/encryption.ts so the deployer can decrypt
 * SSH private keys stored by the edge functions. Uses Node's crypto API
 * (compatible AES-256-GCM IV-prefixed format).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function getKey(): Buffer {
  const hex = process.env.SMTP_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('SMTP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptValue(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Web Crypto's AES-GCM appends the 16-byte tag to the ciphertext on output.
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

export function decryptValue(encrypted: string): string {
  const key = getKey();
  const combined = Buffer.from(encrypted, 'base64');
  const iv = combined.subarray(0, 12);
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
