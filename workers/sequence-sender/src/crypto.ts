/**
 * Crypto Utilities
 *
 * AES-256-GCM encryption/decryption for SMTP credentials and API keys.
 * Node.js port of the Deno edge function crypto logic.
 *
 * Uses Node.js native crypto module (not webcrypto) to avoid type issues.
 */

import crypto from 'node:crypto';

// ============================================================================
// SMTP Credential Encryption (SMTP_ENCRYPTION_KEY)
// ============================================================================

export interface SMTPCredentials {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  imap_host?: string;
  imap_port?: number;
  imap_username?: string;
  imap_password?: string;
}

function getSmtpEncryptionKey(): Buffer {
  const keyHex = process.env.SMTP_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('SMTP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

export function decryptSmtpCredentials(encrypted: string): SMTPCredentials {
  const key = getSmtpEncryptionKey();
  const combined = Buffer.from(encrypted, 'base64');

  const iv = combined.subarray(0, 12);
  // AES-GCM: last 16 bytes are the auth tag
  const authTag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf-8'));
}

export function extractSMTPCredentials(
  metadata: Record<string, unknown>,
): SMTPCredentials | null {
  try {
    const encrypted = metadata?.smtp_credentials as string;
    if (!encrypted) return null;
    return decryptSmtpCredentials(encrypted);
  } catch (error) {
    console.error('[Crypto] Failed to extract SMTP credentials:', error);
    return null;
  }
}

// ============================================================================
// API Key Decryption (ENCRYPTION_KEY)
// ============================================================================

export function decryptApiKey(
  encryptedBase64: string,
  encryptionKeyHex: string,
): string {
  const combined = Buffer.from(encryptedBase64, 'base64');

  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);

  const key = Buffer.from(encryptionKeyHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf-8');
}
