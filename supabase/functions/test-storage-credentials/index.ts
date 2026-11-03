import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper functions for AWS Signature V4
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


// Decrypt credentials - handles both legacy (plain JSON) and new (hex:hex:hex AES-GCM) formats
async function decryptCredentials(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  // Check if it's the new encrypted format (ivHex:authTagHex:encryptedHex)
  const parts = encryptedData.split(':');

  if (parts.length === 3 && parts[0].length === 24 && parts[1].length === 32) {
    // New AES-GCM encrypted format
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const authTag = new Uint8Array(authTagHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const encrypted = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        key,
        new Uint8Array([...encrypted, ...authTag])
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      throw new Error('Decryption failed — the encryption key may have been rotated. Please delete this credential and re-add it.');
    }
  }

  // Legacy format: plain JSON string (for backwards compatibility)
  // Check if it's valid JSON
  try {
    JSON.parse(encryptedData);
    console.log('⚠️ Using legacy unencrypted credentials format');
    return encryptedData;
  } catch {
    throw new Error('Invalid credentials format - not encrypted hex or valid JSON');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  let credential_id: string | undefined;
  try {
    const body = await req.json();
    credential_id = body.credential_id;

    if (!credential_id) {
      throw new Error('credential_id is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the credential
    const { data: credential, error: fetchError } = await supabase
      .from('storage_credentials')
      .select('*')
      .eq('id', credential_id)
      .single();

    if (fetchError || !credential) {
      throw new Error('Storage credential not found');
    }

    // Decrypt the credentials
    console.log(`Credentials encrypted format: ${credential.credentials_encrypted.substring(0, 50)}...`);
    const decryptedJson = await decryptCredentials(credential.credentials_encrypted, encryptionKey);
    console.log(`Decrypted JSON: ${decryptedJson.substring(0, 100)}...`);
    const credentials = JSON.parse(decryptedJson);
    console.log(`Credentials keys: ${Object.keys(credentials).join(', ')}`);

    console.log(`Testing ${credential.provider} storage credentials`);

    const bucketName = credentials.bucketName || credential.bucket_name;

    if (credential.provider === 'cloudflare_r2') {
      // Validate required fields
      if (!credentials.accountId || !credentials.accessKeyId || !credentials.secretAccessKey) {
        throw new Error('Missing required R2 credentials (accountId, accessKeyId, secretAccessKey)');
      }
      if (!bucketName) {
        throw new Error('Missing bucket name');
      }

      // Validate R2 credential format
      if (credentials.accessKeyId.length !== 32) {
        throw new Error(`Invalid R2 Access Key ID: expected 32 characters, got ${credentials.accessKeyId.length}. Please re-enter your R2 API token credentials from the Cloudflare dashboard.`);
      }
      if (credentials.secretAccessKey.length < 40) {
        throw new Error(`Invalid R2 Secret Access Key: expected ~64 characters, got ${credentials.secretAccessKey.length}. Please re-enter your R2 API token credentials from the Cloudflare dashboard.`);
      }

      console.log(`✅ R2 credentials validated:`);
      console.log(`   - accountId: ${credentials.accountId} (${credentials.accountId.length} chars)`);
      console.log(`   - accessKeyId: ${credentials.accessKeyId.length} chars`);
      console.log(`   - secretAccessKey: ${credentials.secretAccessKey.length} chars`);
      console.log(`   - bucket: ${bucketName}`);

      // Test upload with a small file using manual AWS SigV4
      const testContent = `Test upload at ${new Date().toISOString()}`;
      const testPath = `test/connection-test-${Date.now()}.txt`;
      const host = `${credentials.accountId}.r2.cloudflarestorage.com`;
      const url = `https://${host}/${bucketName}/${testPath}`;
      const contentType = 'text/plain';

      // AWS Signature V4 implementation
      const region = 'auto';
      const service = 's3';
      const method = 'PUT';

      // Create date strings
      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.substring(0, 8);

      // Hash the payload
      const encoder = new TextEncoder();
      const payloadHash = await sha256Hex(encoder.encode(testContent));

      // Create canonical request
      // For path-style URLs, the canonical URI is /{bucket}/{key}
      const canonicalUri = `/${bucketName}/${testPath}`;
      const canonicalQueryString = '';
      const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
      const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

      // Create string to sign
      const algorithm = 'AWS4-HMAC-SHA256';
      const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
      const canonicalRequestHash = await sha256Hex(encoder.encode(canonicalRequest));
      const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

      // Calculate signature
      const kDate = await hmacSha256(`AWS4${credentials.secretAccessKey}`, dateStamp);
      const kRegion = await hmacSha256(kDate, region);
      const kService = await hmacSha256(kRegion, service);
      const kSigning = await hmacSha256(kService, 'aws4_request');
      const signature = await hmacSha256Hex(kSigning, stringToSign);

      // Create authorization header
      const authorizationHeader = `${algorithm} Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      console.log(`⬆️ Test upload to: ${url}`);

      const uploadResponse = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': authorizationHeader,
          'Content-Type': contentType,
          'x-amz-content-sha256': payloadHash,
          'x-amz-date': amzDate,
        },
        body: testContent,
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error(`❌ R2 upload failed (${uploadResponse.status}):`, errorText);
        throw new Error(`R2 upload test failed: ${uploadResponse.status} - ${errorText}`);
      }

      console.log(`✅ R2 test upload succeeded!`);
    } else if (credential.provider === 'aws_s3') {
      if (!credentials.accessKeyId || !credentials.secretAccessKey) {
        throw new Error('Missing required AWS credentials (accessKeyId, secretAccessKey)');
      }
      if (!bucketName) {
        throw new Error('Missing bucket name');
      }
      console.log(`✅ AWS S3 credentials validated: region=${credentials.region || 'us-east-1'}, bucket=${bucketName}`);
    } else if (credential.provider === 'backblaze_b2') {
      if (!credentials.keyId || !credentials.applicationKey || !credentials.endpoint) {
        throw new Error('Missing required B2 credentials (keyId, applicationKey, endpoint)');
      }
      if (!bucketName) {
        throw new Error('Missing bucket name');
      }
      console.log(`✅ B2 credentials validated: endpoint=${credentials.endpoint}, bucket=${bucketName}`);
    } else {
      throw new Error(`Unsupported provider: ${credential.provider}`);
    }

    // Update the credential as valid
    await supabase
      .from('storage_credentials')
      .update({
        is_valid: true,
        last_tested_at: new Date().toISOString(),
        error_message: null
      })
      .eq('id', credential_id);

    return new Response(JSON.stringify({ valid: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Storage test error:', error);

    // Try to update the credential as invalid
    try {
      if (credential_id) {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );
        await supabase
          .from('storage_credentials')
          .update({
            is_valid: false,
            last_tested_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : 'Test failed'
          })
          .eq('id', credential_id);
      }
    } catch (e) {
      // Ignore update errors
    }

    return new Response(
      JSON.stringify({
        valid: false,
        error: error instanceof Error ? error.message : 'Test failed'
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
