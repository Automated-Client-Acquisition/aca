import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Crypto helpers (AWS Signature V4 — for presigned URLs) ───────────────

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
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function hmacSha256Hex(key: ArrayBuffer, data: string): Promise<string> {
  const buf = await hmacSha256(key, data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Encryption helper ─────────────────────────────────────────────────────

async function decryptCredentials(encrypted: string, key: string): Promise<string> {
  const [ivHex, authTagHex, encryptedHex] = encrypted.split(':');
  const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const authTag = new Uint8Array(authTagHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const ciphertext = new Uint8Array(encryptedHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));

  const keyBytes = new Uint8Array(key.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );

  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    cryptoKey,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

// ── Presigned URL generators ──────────────────────────────────────────────

/**
 * Generate a presigned PUT URL for R2 or S3 using AWS Signature V4.
 * The browser will upload directly to this URL.
 */
async function generatePresignedUrl(
  host: string,
  canonicalUri: string,
  region: string,
  service: string,
  accessKeyId: string,
  secretAccessKey: string,
  contentType: string,
  expiresIn: number = 3600,
): Promise<string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  // Query parameters for presigned URL (sorted alphabetically)
  const queryParams = new URLSearchParams();
  queryParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  queryParams.set('X-Amz-Credential', credential);
  queryParams.set('X-Amz-Date', amzDate);
  queryParams.set('X-Amz-Expires', String(expiresIn));
  queryParams.set('X-Amz-SignedHeaders', 'content-type;host');
  queryParams.sort();

  const canonicalQueryString = queryParams.toString();
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';

  // For presigned URLs, payload hash is UNSIGNED-PAYLOAD
  const canonicalRequest = `PUT\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;

  const canonicalRequestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  queryParams.set('X-Amz-Signature', signature);

  return `https://${host}${canonicalUri}?${queryParams.toString()}`;
}

async function presignR2(
  credentials: any, parsedCreds: any, path: string, contentType: string,
): Promise<{ uploadUrl: string; publicUrl: string; headers: Record<string, string> }> {
  const accountId = parsedCreds.accountId;
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${bucketName}/${path}`;

  const uploadUrl = await generatePresignedUrl(
    host, canonicalUri, 'auto', 's3',
    parsedCreds.accessKeyId, parsedCreds.secretAccessKey,
    contentType,
  );

  const publicUrl = credentials.public_url
    ? `${credentials.public_url}/${path}`
    : `https://${host}/${bucketName}/${path}`;

  return { uploadUrl, publicUrl, headers: { 'Content-Type': contentType } };
}

async function presignS3(
  credentials: any, parsedCreds: any, path: string, contentType: string,
): Promise<{ uploadUrl: string; publicUrl: string; headers: Record<string, string> }> {
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const region = parsedCreds.region || 'us-east-1';
  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const canonicalUri = `/${path}`;

  const uploadUrl = await generatePresignedUrl(
    host, canonicalUri, region, 's3',
    parsedCreds.accessKeyId, parsedCreds.secretAccessKey,
    contentType,
  );

  const publicUrl = credentials.public_url
    ? `${credentials.public_url}/${path}`
    : `https://${host}/${path}`;

  return { uploadUrl, publicUrl, headers: { 'Content-Type': contentType } };
}

async function presignB2(
  credentials: any, parsedCreds: any, path: string, contentType: string,
): Promise<{ uploadUrl: string; publicUrl: string; headers: Record<string, string> }> {
  // B2 doesn't use presigned URLs — it uses b2_get_upload_url + auth token
  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { 'Authorization': `Basic ${btoa(`${parsedCreds.keyId}:${parsedCreds.applicationKey}`)}` },
  });
  const authData = await authResponse.json();

  const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { 'Authorization': authData.authorizationToken },
    body: JSON.stringify({ bucketId: parsedCreds.bucketId }),
  });
  const uploadUrlData = await uploadUrlResponse.json();

  const publicUrl = credentials.public_url
    ? `${credentials.public_url}/${path}`
    : `${authData.downloadUrl}/file/${credentials.bucket_name || parsedCreds.bucketName}/${path}`;

  return {
    uploadUrl: uploadUrlData.uploadUrl,
    publicUrl,
    headers: {
      'Authorization': uploadUrlData.authorizationToken,
      'Content-Type': contentType,
      'X-Bz-File-Name': encodeURIComponent(path),
      'X-Bz-Content-Sha1': 'do_not_verify',
    },
  };
}

// ── Main handler ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Auth: get user from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get org from user
    const { data: memberData } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!memberData) {
      return new Response(JSON.stringify({ error: 'No organization found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const organizationId = memberData.organization_id;

    // Parse JSON body (no file data — just metadata)
    const body = await req.json();
    const { fileName, contentType: fileContentType, mediaType, folder } = body;

    if (!fileName) {
      return new Response(JSON.stringify({ error: 'fileName is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get storage credentials
    const { data: credentials } = await supabase
      .from('storage_credentials')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .single();

    if (!credentials) {
      return new Response(JSON.stringify({
        error: 'No storage configured. Go to Settings > Storage to add your storage credentials.',
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Decrypt credentials
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    let parsedCreds: any;
    const credValue = credentials.credentials_encrypted;
    if (credValue.includes(':') && !credValue.startsWith('{')) {
      const decryptedJson = await decryptCredentials(credValue, encryptionKey);
      parsedCreds = JSON.parse(decryptedJson);
    } else {
      parsedCreds = JSON.parse(credValue);
    }

    // Generate storage path
    const ext = fileName.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'png');
    const timestamp = Date.now();
    const storagePath = `${folder || 'presenter-uploads'}/${organizationId}/${timestamp}.${ext}`;
    const contentType = fileContentType || (mediaType === 'video' ? 'video/mp4' : 'image/png');

    // Generate presigned URL based on provider
    let result: { uploadUrl: string; publicUrl: string; headers: Record<string, string> };

    if (credentials.provider === 'cloudflare_r2') {
      result = await presignR2(credentials, parsedCreds, storagePath, contentType);
    } else if (credentials.provider === 'backblaze_b2') {
      result = await presignB2(credentials, parsedCreds, storagePath, contentType);
    } else if (credentials.provider === 'aws_s3') {
      result = await presignS3(credentials, parsedCreds, storagePath, contentType);
    } else {
      throw new Error(`Unsupported storage provider: ${credentials.provider}`);
    }

    console.log(`Presigned URL generated for ${fileName} → ${credentials.provider}: ${storagePath}`);

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Upload presign failed:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
