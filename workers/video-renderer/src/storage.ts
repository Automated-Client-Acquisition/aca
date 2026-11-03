/**
 * Storage Upload — Upload rendered video output to Supabase Storage.
 *
 * Follows the same pattern as carousel-renderer's storage-upload.ts.
 * Uploads files to the org's active storage provider (R2/S3/B2)
 * with fallback to Supabase content-media bucket.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { SupabaseClient } from '@supabase/supabase-js';

// ─── Main Upload Function ────────────────────────────────────────────────────

/**
 * Upload a rendered video file to user-configured storage with Supabase fallback.
 */
export async function uploadRenderedVideo(
  supabase: SupabaseClient,
  organizationId: string,
  filePath: string,
  storagePath: string,
  encryptionKey?: string,
): Promise<{ url: string; warning?: string }> {
  const fileData = await fs.promises.readFile(filePath);
  const fileSizeMB = (fileData.length / (1024 * 1024)).toFixed(1);
  console.log(`[Storage] File size: ${fileSizeMB} MB (${fileData.length} bytes)`);
  const contentType = 'video/mp4';

  // Try user-configured storage first
  try {
    const url = await uploadToUserStorage(supabase, organizationId, fileData, storagePath, contentType, encryptionKey);
    return { url };
  } catch (err: any) {
    console.warn(`[Storage] User storage failed (${err.message}), falling back to Supabase bucket`);
  }

  // Fallback: Supabase content-media bucket
  const fileName = storagePath.split('/').pop() || storagePath;
  const { error } = await supabase.storage
    .from('content-media')
    .upload(fileName, fileData, { contentType, upsert: true });

  if (error) {
    throw new Error(`Both user storage and Supabase fallback failed: ${error.message}`);
  }

  const { data: { publicUrl } } = supabase.storage.from('content-media').getPublicUrl(fileName);
  return { url: publicUrl, warning: 'Stored in Supabase fallback — user storage upload failed' };
}

// ─── User Storage Upload ─────────────────────────────────────────────────────

async function uploadToUserStorage(
  supabase: SupabaseClient,
  organizationId: string,
  fileData: Buffer,
  storagePath: string,
  contentType: string,
  encryptionKeyParam?: string,
): Promise<string> {
  // Fetch org's active storage credentials
  const { data: credentials, error } = await supabase
    .from('storage_credentials')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .single();

  if (error || !credentials) {
    throw new Error('No active storage credentials found');
  }

  // Encryption key: prefer the one passed from the edge function, fall back to env var
  const encryptionKey = encryptionKeyParam || process.env.ENCRYPTION_KEY;
  const keySource = encryptionKeyParam ? 'request param' : 'env var';
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY not configured — pass it from the edge function or set it as an env var');
  }
  console.log(`[Storage] Using encryption key from ${keySource} (length: ${encryptionKey.length} chars)`);

  // Decrypt credentials
  const credValue = credentials.credentials_encrypted;
  let parsedCreds: any;

  // Detect credential format for diagnostics
  const credFormat = credValue.startsWith('{') ? 'plain JSON'
    : (credValue.includes(':') && !credValue.startsWith('{')) ? 'hex (iv:tag:data)'
    : 'base64 (legacy)';
  console.log(`[Storage] Credential format: ${credFormat}, provider: ${credentials.provider}`);

  try {
    if (credValue.includes(':') && !credValue.startsWith('{')) {
      parsedCreds = JSON.parse(decryptCredentials(credValue, encryptionKey));
    } else if (credValue.startsWith('{')) {
      parsedCreds = JSON.parse(credValue);
    } else {
      parsedCreds = JSON.parse(decryptCredentialsBase64(credValue, encryptionKey));
    }
  } catch (decryptErr: any) {
    throw new Error(
      `Credential decryption failed (format: ${credFormat}, key source: ${keySource}, key length: ${encryptionKey.length}): ${decryptErr.message}`
    );
  }

  // Route to provider
  if (credentials.provider === 'cloudflare_r2') {
    return uploadToCloudflareR2(credentials, parsedCreds, storagePath, fileData, contentType);
  } else if (credentials.provider === 'backblaze_b2') {
    return uploadToBackblazeB2(credentials, parsedCreds, storagePath, fileData, contentType);
  } else if (credentials.provider === 'aws_s3') {
    return uploadToAwsS3(credentials, parsedCreds, storagePath, fileData, contentType);
  }

  throw new Error(`Unsupported storage provider: ${credentials.provider}`);
}

// ─── Cloudflare R2 ───────────────────────────────────────────────────────────

async function uploadToCloudflareR2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  // Credentials may be camelCase (from frontend) or snake_case
  const accessKeyId = parsedCreds.accessKeyId || parsedCreds.access_key_id;
  const secretAccessKey = parsedCreds.secretAccessKey || parsedCreds.secret_access_key;
  const accountId = parsedCreds.accountId || parsedCreds.account_id;
  const bucketName = credentials.bucket_name;

  if (!accountId) {
    throw new Error('R2 accountId missing from decrypted credentials');
  }

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('R2 accessKeyId or secretAccessKey missing from decrypted credentials');
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/${bucketName}/${path}`;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');

  const hashHex = sha256Hex(data);
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${hashHex}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n/${bucketName}/${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${hashHex}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${sha256Hex(Buffer.from(canonicalRequest))}`;

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = hmacHex(signingKey, stringToSign);
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-content-sha256': hashHex,
      'x-amz-date': amzDate,
    },
    body: new Uint8Array(data),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`R2 upload failed (${response.status}): ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

// ─── Backblaze B2 ────────────────────────────────────────────────────────────

async function uploadToBackblazeB2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const keyId = parsedCreds.keyId || parsedCreds.key_id;
  const applicationKey = parsedCreds.applicationKey || parsedCreds.application_key;

  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { 'Authorization': `Basic ${Buffer.from(`${keyId}:${applicationKey}`).toString('base64')}` },
  });
  if (!authResponse.ok) throw new Error('B2 auth failed');
  const authData = await authResponse.json() as any;

  const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { 'Authorization': authData.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: credentials.bucket_id || parsedCreds.bucket_id }),
  });
  if (!uploadUrlResponse.ok) throw new Error('B2 get upload URL failed');
  const uploadUrlData = await uploadUrlResponse.json() as any;

  const sha1Hash = sha1Hex(data);

  const uploadResponse = await fetch(uploadUrlData.uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': uploadUrlData.authorizationToken,
      'X-Bz-File-Name': encodeURIComponent(path),
      'Content-Type': contentType,
      'Content-Length': String(data.length),
      'X-Bz-Content-Sha1': sha1Hash,
    },
    body: new Uint8Array(data),
  });

  if (!uploadResponse.ok) throw new Error('B2 upload failed');

  const bucketName = credentials.bucket_name;
  return credentials.public_url
    ? `${credentials.public_url}/${path}`
    : `${authData.downloadUrl}/file/${bucketName}/${path}`;
}

// ─── AWS S3 ──────────────────────────────────────────────────────────────────

async function uploadToAwsS3(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const accessKeyId = parsedCreds.accessKeyId || parsedCreds.access_key_id;
  const secretAccessKey = parsedCreds.secretAccessKey || parsedCreds.secret_access_key;
  const bucketName = credentials.bucket_name;
  const region = credentials.region || 'us-east-1';

  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${path}`;
  const service = 's3';
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');

  const hashHex = sha256Hex(data);
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-acl:public-read\nx-amz-content-sha256:${hashHex}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-acl;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n/${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${hashHex}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${sha256Hex(Buffer.from(canonicalRequest))}`;

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = hmacHex(signingKey, stringToSign);
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-acl': 'public-read',
      'x-amz-content-sha256': hashHex,
      'x-amz-date': amzDate,
    },
    body: new Uint8Array(data),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`S3 upload failed (${response.status}): ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

// ─── Crypto Helpers ──────────────────────────────────────────────────────────

function decryptCredentials(encryptedData: string, encryptionKeyHex: string): string {
  const [ivHex, authTagHex, encryptedHex] = encryptedData.split(':');
  const key = Buffer.from(encryptionKeyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plaintext.toString('utf-8');
}

function decryptCredentialsBase64(encryptedBase64: string, encryptionKeyHex: string): string {
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

function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sha1Hex(data: Buffer): string {
  return crypto.createHash('sha1').update(data).digest('hex');
}

function hmacSign(key: Buffer, msg: string): Buffer {
  return crypto.createHmac('sha256', key).update(msg).digest();
}

function hmacHex(key: Buffer, msg: string): string {
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSign(Buffer.from(`AWS4${key}`), dateStamp);
  const kRegion = hmacSign(kDate, region);
  const kService = hmacSign(kRegion, service);
  return hmacSign(kService, 'aws4_request');
}

// ─── Cleanup Helper ──────────────────────────────────────────────────────────

/**
 * Remove a temporary file. Best-effort, ignores errors.
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore — file may not exist or already cleaned up
  }
}
