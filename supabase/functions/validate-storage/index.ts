import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Encrypt credentials using AES-256-GCM (hex:hex:hex format)
async function encryptCredentials(data: string, encryptionKeyHex: string): Promise<string> {
  const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(data)
  );

  const encryptedArray = new Uint8Array(encrypted);
  // AES-GCM appends auth tag at the end (last 16 bytes)
  const ciphertext = encryptedArray.slice(0, -16);
  const authTag = encryptedArray.slice(-16);

  // Convert to hex strings
  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  const authTagHex = Array.from(authTag).map(b => b.toString(16).padStart(2, '0')).join('');
  const encryptedHex = Array.from(ciphertext).map(b => b.toString(16).padStart(2, '0')).join('');

  return `${ivHex}:${authTagHex}:${encryptedHex}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { provider, credentials } = await req.json();

    console.log(`Validating ${provider} storage credentials`);

    // Validate required fields based on provider
    let result: { valid: boolean; error?: string };

    switch (provider) {
      case 'cloudflare_r2':
        result = validateCloudflareR2Fields(credentials);
        break;
      case 'aws_s3':
        result = validateAwsS3Fields(credentials);
        break;
      case 'backblaze_b2':
        result = validateBackblazeB2Fields(credentials);
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    console.log(`Validation result for ${provider}:`, result.valid);

    // If valid, encrypt the credentials
    if (result.valid) {
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
      if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY not configured');
      }

      const encryptedCredentials = await encryptCredentials(JSON.stringify(credentials), encryptionKey);
      return new Response(JSON.stringify({
        valid: true,
        encryptedCredentials
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Storage validation error:', error);
    return new Response(
      JSON.stringify({
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed'
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// Simple field validation - actual bucket access test happens via test-storage-credentials
function validateCloudflareR2Fields(credentials: any): { valid: boolean; error?: string } {
  const { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl } = credentials;

  if (!accountId || typeof accountId !== 'string' || accountId.trim() === '') {
    return { valid: false, error: 'Account ID is required' };
  }
  if (!accessKeyId || typeof accessKeyId !== 'string' || accessKeyId.trim() === '') {
    return { valid: false, error: 'Access Key ID is required' };
  }
  if (!secretAccessKey || typeof secretAccessKey !== 'string' || secretAccessKey.trim() === '') {
    return { valid: false, error: 'Secret Access Key is required' };
  }
  if (!bucketName || typeof bucketName !== 'string' || bucketName.trim() === '') {
    return { valid: false, error: 'Bucket name is required' };
  }
  if (!publicUrl || typeof publicUrl !== 'string' || publicUrl.trim() === '') {
    return { valid: false, error: 'Public URL is required for R2' };
  }
  // Validate public URL format
  try {
    new URL(publicUrl);
  } catch {
    return { valid: false, error: 'Public URL must be a valid URL' };
  }

  return { valid: true };
}

function validateAwsS3Fields(credentials: any): { valid: boolean; error?: string } {
  const { accessKeyId, secretAccessKey, region, bucketName } = credentials;

  if (!accessKeyId || typeof accessKeyId !== 'string' || accessKeyId.trim() === '') {
    return { valid: false, error: 'Access Key ID is required' };
  }
  if (!secretAccessKey || typeof secretAccessKey !== 'string' || secretAccessKey.trim() === '') {
    return { valid: false, error: 'Secret Access Key is required' };
  }
  if (!region || typeof region !== 'string' || region.trim() === '') {
    return { valid: false, error: 'Region is required' };
  }
  if (!bucketName || typeof bucketName !== 'string' || bucketName.trim() === '') {
    return { valid: false, error: 'Bucket name is required' };
  }

  return { valid: true };
}

function validateBackblazeB2Fields(credentials: any): { valid: boolean; error?: string } {
  const { keyId, applicationKey, bucketName, bucketId, endpoint } = credentials;

  if (!keyId || typeof keyId !== 'string' || keyId.trim() === '') {
    return { valid: false, error: 'Key ID is required' };
  }
  if (!applicationKey || typeof applicationKey !== 'string' || applicationKey.trim() === '') {
    return { valid: false, error: 'Application Key is required' };
  }
  if (!bucketName || typeof bucketName !== 'string' || bucketName.trim() === '') {
    return { valid: false, error: 'Bucket name is required' };
  }
  if (!bucketId || typeof bucketId !== 'string' || bucketId.trim() === '') {
    return { valid: false, error: 'Bucket ID is required' };
  }
  if (!endpoint || typeof endpoint !== 'string' || endpoint.trim() === '') {
    return { valid: false, error: 'Endpoint is required' };
  }
  // Validate endpoint URL format
  try {
    new URL(endpoint);
  } catch {
    return { valid: false, error: 'Endpoint must be a valid URL' };
  }

  return { valid: true };
}
