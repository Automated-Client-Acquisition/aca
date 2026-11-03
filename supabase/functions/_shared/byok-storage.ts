/**
 * BYOK (Bring Your Own Key) Storage Module
 *
 * Shared utility for uploading media to the organization's configured
 * storage provider (Cloudflare R2, AWS S3, or Backblaze B2).
 *
 * Previously this logic was copy-pasted across:
 * - generation-completion-webhook
 * - check-prediction-status
 * - apify-webhook
 * - heygen-webhook
 * - fetch-youtube-channel
 *
 * Usage:
 *   import { uploadToStorage, persistExternalUrl } from '../_shared/byok-storage.ts';
 *   const permanentUrl = await persistExternalUrl(supabase, orgId, tempUrl, 'video', projectId);
 *
 * Self-hosted installs (ACA_SELF_HOSTED) own their Supabase Storage, so an org
 * with no BYOK storage gets its media in the `content-media` bucket instead of
 * an error. ACA Cloud still requires BYOK storage.
 */

import { SELF_HOSTED } from './site-config.ts';

// ─── Crypto Helpers (AWS Signature V4 + AES-GCM) ────────────────────────────

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
  const signatureBuffer = await hmacSha256(key, data);
  return Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decrypt credentials using AES-GCM.
 * Supports:
 * 1. Hex colon format (legacy): ivHex:authTagHex:encryptedHex
 * 2. Base64 format (new): IV + ciphertext combined in base64
 * 3. Plain JSON (legacy unencrypted): raw JSON string
 */
async function decryptCredentials(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  // Check if it's the legacy hex:colons format (contains exactly 2 colons)
  const parts = encryptedData.split(':');
  if (parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p))) {
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const authTag = new Uint8Array(authTagHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const encrypted = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        new Uint8Array([...encrypted, ...authTag])
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      throw new Error('Decryption failed - the encryption key may have been rotated. Please delete this storage credential and re-add it.');
    }
  }

  // New format: Base64 encoded (IV + ciphertext combined)
  try {
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    // Legacy format: plain JSON string (for backwards compatibility)
    try {
      JSON.parse(encryptedData);
      console.log('Warning: Using legacy unencrypted credentials format');
      return encryptedData;
    } catch {
      throw new Error('Invalid credentials format');
    }
  }
}

// ─── Provider Upload Functions ───────────────────────────────────────────────

async function uploadToCloudflareR2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  contentType: string
): Promise<string> {
  const accountId = parsedCreds.accountId;
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const accessKeyId = parsedCreds.accessKeyId;
  const secretAccessKey = parsedCreds.secretAccessKey;

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    throw new Error(`Missing R2 credentials: accountId=${!!accountId}, bucket=${!!bucketName}, key=${!!accessKeyId}, secret=${!!secretAccessKey}`);
  }

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucketName}/${path}`;
  const region = 'auto';
  const service = 's3';
  const method = 'PUT';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const encoder = new TextEncoder();
  const payloadBytes = new Uint8Array(await data.arrayBuffer());
  const payloadHash = await sha256Hex(payloadBytes);

  const canonicalUri = `/${bucketName}/${path}`;
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(encoder.encode(canonicalRequest));
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: data,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`R2 upload failed: ${response.status} - ${response.statusText} - ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

async function uploadToBackblazeB2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  contentType: string
): Promise<string> {
  const keyId = parsedCreds.keyId;
  const applicationKey = parsedCreds.applicationKey;
  const bucketId = parsedCreds.bucketId;

  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      'Authorization': `Basic ${btoa(`${keyId}:${applicationKey}`)}`,
    },
  });
  const authData = await authResponse.json();

  const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      'Authorization': authData.authorizationToken,
    },
    body: JSON.stringify({ bucketId }),
  });
  const uploadUrlData = await uploadUrlResponse.json();

  const uploadResponse = await fetch(uploadUrlData.uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': uploadUrlData.authorizationToken,
      'Content-Type': contentType,
      'X-Bz-File-Name': encodeURIComponent(path),
      'X-Bz-Content-Sha1': 'do_not_verify',
    },
    body: data,
  });

  if (!uploadResponse.ok) {
    throw new Error(`B2 upload failed: ${uploadResponse.statusText}`);
  }

  const uploadData = await uploadResponse.json();
  return credentials.public_url ? `${credentials.public_url}/${path}` : uploadData.fileUrl;
}

async function uploadToAwsS3(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  contentType: string
): Promise<string> {
  const accessKeyId = parsedCreds.accessKeyId;
  const secretAccessKey = parsedCreds.secretAccessKey;
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const region = parsedCreds.region || 'us-east-1';

  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${path}`;
  const service = 's3';
  const method = 'PUT';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const encoder = new TextEncoder();
  const payloadBytes = new Uint8Array(await data.arrayBuffer());
  const payloadHash = await sha256Hex(payloadBytes);

  const canonicalUri = `/${path}`;
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalRequestHash = await sha256Hex(encoder.encode(canonicalRequest));
  const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authorizationHeader,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: data,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`S3 upload failed: ${response.status} - ${response.statusText} - ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

// ─── Storage Credential Resolution ──────────────────────────────────────────

interface StorageCredentials {
  raw: any; // The DB row (provider, bucket_name, public_url, etc.)
  parsed: any; // Decrypted credential JSON
}

/**
 * Resolve and decrypt the organization's active BYOK storage credentials.
 * Caches nothing - always fresh from DB.
 */
export async function resolveStorageCredentials(
  supabase: any,
  organizationId: string,
): Promise<StorageCredentials> {
  const { data: credentials } = await supabase
    .from('storage_credentials')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .single();

  if (!credentials) {
    throw new Error('No active storage credentials found for this organization');
  }

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  const credValue = credentials.credentials_encrypted;
  let parsed: any;

  if (credValue.includes(':') && !credValue.startsWith('{')) {
    const decryptedJson = await decryptCredentials(credValue, encryptionKey);
    parsed = JSON.parse(decryptedJson);
  } else {
    parsed = JSON.parse(credValue);
  }

  return { raw: credentials, parsed };
}

/** Whether the org has active BYOK storage. */
export async function hasStorageCredentials(supabase: any, organizationId: string): Promise<boolean> {
  const { data } = await supabase
    .from('storage_credentials')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/** Upload to the install's own `content-media` bucket and return its public URL. */
async function uploadToSupabaseStorage(supabase: any, path: string, data: Blob, contentType: string): Promise<string> {
  const { error } = await supabase.storage.from('content-media').upload(path, data, { contentType, upsert: true });
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  return supabase.storage.from('content-media').getPublicUrl(path).data.publicUrl;
}

// ─── Content Type Helpers ────────────────────────────────────────────────────

type MediaType = 'video' | 'image' | 'audio';

function inferContentType(mediaType: MediaType, url: string): string {
  const lower = url.toLowerCase();

  if (mediaType === 'video') {
    if (lower.includes('.webm')) return 'video/webm';
    return 'video/mp4';
  }
  if (mediaType === 'audio') {
    if (lower.includes('.wav')) return 'audio/wav';
    if (lower.includes('.ogg')) return 'audio/ogg';
    return 'audio/mpeg';
  }
  // image
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

function inferExtension(mediaType: MediaType, url: string): string {
  const lower = url.toLowerCase();

  if (mediaType === 'video') {
    if (lower.includes('.webm')) return 'webm';
    return 'mp4';
  }
  if (mediaType === 'audio') {
    if (lower.includes('.wav')) return 'wav';
    if (lower.includes('.ogg')) return 'ogg';
    if (lower.includes('.mp3')) return 'mp3';
    return 'mp3';
  }
  // image
  if (lower.includes('.webp')) return 'webp';
  if (lower.includes('.png')) return 'png';
  return 'jpg';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Upload a blob to the organization's BYOK storage (or, self-hosted with none,
 * to Supabase Storage). Returns the permanent public URL.
 */
export async function uploadToStorage(
  supabase: any,
  organizationId: string,
  temporaryUrl: string,
  mediaType: MediaType,
  outputId: string,
): Promise<string> {
  // Download from temporary URL
  console.log(`Downloading ${mediaType} from ${temporaryUrl}`);
  const response = await fetch(temporaryUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${mediaType}: ${response.status} ${response.statusText}`);
  }
  const fileBlob = await response.blob();

  return await uploadBlobToStorage(
    supabase,
    organizationId,
    fileBlob,
    mediaType,
    outputId,
    inferExtension(mediaType, temporaryUrl),
    inferContentType(mediaType, temporaryUrl),
  );
}

/**
 * Upload bytes already in hand to the organization's BYOK storage, for sources
 * that can't be fetched by URL alone (e.g. OpenRouter video content, which
 * needs the API key in the Authorization header). Returns the permanent URL.
 * Throws when the org has no active storage credentials, unless self-hosted.
 */
export async function uploadBlobToStorage(
  supabase: any,
  organizationId: string,
  fileBlob: Blob,
  mediaType: MediaType,
  outputId: string,
  extension: string,
  contentType: string,
): Promise<string> {
  // Generate storage path
  const timestamp = Date.now();
  const filename = `${outputId}_${timestamp}.${extension}`;
  const storagePath = `content-outputs/${mediaType}s/${filename}`;

  if (SELF_HOSTED && !(await hasStorageCredentials(supabase, organizationId))) {
    return await uploadToSupabaseStorage(supabase, `${organizationId}/${storagePath}`, fileBlob, contentType);
  }

  const { raw: credentials, parsed: parsedCreds } = await resolveStorageCredentials(supabase, organizationId);

  // Upload to the configured provider
  let publicUrl: string;

  if (credentials.provider === 'cloudflare_r2') {
    publicUrl = await uploadToCloudflareR2(credentials, parsedCreds, storagePath, fileBlob, contentType);
  } else if (credentials.provider === 'backblaze_b2') {
    publicUrl = await uploadToBackblazeB2(credentials, parsedCreds, storagePath, fileBlob, contentType);
  } else if (credentials.provider === 'aws_s3') {
    publicUrl = await uploadToAwsS3(credentials, parsedCreds, storagePath, fileBlob, contentType);
  } else {
    throw new Error(`Unsupported storage provider: ${credentials.provider}`);
  }

  console.log(`Uploaded ${mediaType} to ${credentials.provider}: ${publicUrl}`);
  return publicUrl;
}

/**
 * Check if a URL is already on the org's permanent storage (BYOK or Supabase).
 * Returns true if the URL doesn't need to be persisted.
 */
export function isPersistedUrl(url: string, supabaseUrl: string, storagePublicUrl?: string): boolean {
  if (!url) return true;
  // Relative paths or non-HTTP URLs are not external - skip them
  if (!url.startsWith('http://') && !url.startsWith('https://')) return true;
  // Already on Supabase Storage
  if (url.startsWith(supabaseUrl)) return true;
  // Already on the org's BYOK CDN
  if (storagePublicUrl && url.startsWith(storagePublicUrl)) return true;
  return false;
}

/**
 * Persist an external URL to BYOK storage if it's not already persisted.
 * Returns the permanent URL (unchanged if already persisted).
 */
export async function persistExternalUrl(
  supabase: any,
  organizationId: string,
  url: string,
  mediaType: MediaType,
  outputId: string,
  supabaseUrl: string,
  storagePublicUrl?: string,
): Promise<string> {
  if (!url) return url;
  if (isPersistedUrl(url, supabaseUrl, storagePublicUrl)) return url;

  return await uploadToStorage(supabase, organizationId, url, mediaType, outputId);
}
