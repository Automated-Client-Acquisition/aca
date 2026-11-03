/**
 * Storage Upload — User-configured storage providers
 *
 * Node.js port of the Deno `uploadToStorage()` pattern from
 * supabase/functions/heygen-webhook/index.ts and generation-completion-webhook/index.ts.
 *
 * Uploads files to the org's active storage provider (Cloudflare R2, AWS S3, or Backblaze B2)
 * using credentials decrypted from `storage_credentials` table.
 */

import crypto from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';

// ─── Main Upload Function ────────────────────────────────────────────────────

export async function uploadToUserStorage(
  supabase: SupabaseClient,
  organizationId: string,
  fileData: Uint8Array,
  storagePath: string,
  mediaType: 'image' | 'video',
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

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  // Decrypt credentials
  const credValue = credentials.credentials_encrypted;
  let parsedCreds: any;

  if (credValue.includes(':') && !credValue.startsWith('{')) {
    // New format: ivHex:authTagHex:encryptedHex
    const decryptedJson = decryptCredentials(credValue, encryptionKey);
    parsedCreds = JSON.parse(decryptedJson);
  } else if (credValue.startsWith('{')) {
    // Legacy unencrypted JSON
    parsedCreds = JSON.parse(credValue);
  } else {
    // Legacy base64 format
    const decryptedJson = decryptCredentialsBase64(credValue, encryptionKey);
    parsedCreds = JSON.parse(decryptedJson);
  }

  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/png';

  // Route to provider
  let publicUrl: string;

  if (credentials.provider === 'cloudflare_r2') {
    publicUrl = await uploadToCloudflareR2(credentials, parsedCreds, storagePath, fileData, contentType);
  } else if (credentials.provider === 'backblaze_b2') {
    publicUrl = await uploadToBackblazeB2(credentials, parsedCreds, storagePath, fileData, contentType);
  } else if (credentials.provider === 'aws_s3') {
    publicUrl = await uploadToAwsS3(credentials, parsedCreds, storagePath, fileData, contentType);
  } else {
    throw new Error(`Unsupported storage provider: ${credentials.provider}`);
  }

  return publicUrl;
}

// ─── Cloudflare R2 ───────────────────────────────────────────────────────────

async function uploadToCloudflareR2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Uint8Array,
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

  // AWS Signature V4
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
    body: Buffer.from(data),
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
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  const { key_id: keyId, application_key: applicationKey } = parsedCreds;

  // Authorize
  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { 'Authorization': `Basic ${Buffer.from(`${keyId}:${applicationKey}`).toString('base64')}` },
  });
  if (!authResponse.ok) throw new Error('B2 auth failed');
  const authData = await authResponse.json() as any;

  // Get upload URL
  const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { 'Authorization': authData.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: credentials.bucket_id || parsedCreds.bucket_id }),
  });
  if (!uploadUrlResponse.ok) throw new Error('B2 get upload URL failed');
  const uploadUrlData = await uploadUrlResponse.json() as any;

  // Upload
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
    body: Buffer.from(data),
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
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  const { access_key_id: accessKeyId, secret_access_key: secretAccessKey } = parsedCreds;
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
    body: Buffer.from(data),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`S3 upload failed (${response.status}): ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

// ─── Crypto Helpers ──────────────────────────────────────────────────────────

/**
 * Decrypt storage credentials in ivHex:authTagHex:encryptedHex format.
 */
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

/**
 * Decrypt storage credentials in legacy base64 format (iv + ciphertext + authTag combined).
 */
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

function sha256Hex(data: Uint8Array | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sha1Hex(data: Uint8Array | Buffer): string {
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
