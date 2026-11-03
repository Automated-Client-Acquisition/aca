import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { uploadToStorage as uploadToByokStorage } from '../_shared/byok-storage.ts';
import { SELF_HOSTED } from '../_shared/site-config.ts';

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

// Decrypt credentials using AES-GCM
// Supports two formats:
// 1. Base64 format (new): IV + ciphertext combined in base64
// 2. Hex with colons format (legacy): ivHex:authTagHex:encryptedHex
async function decryptCredentials(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  // Check if it's the legacy hex:colons format (contains exactly 2 colons)
  const parts = encryptedData.split(':');
  if (parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p))) {
    // Legacy format: ivHex:authTagHex:encryptedHex
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
      throw new Error('Decryption failed — the encryption key may have been rotated. Please delete this storage credential and re-add it.');
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
      console.log('⚠️ Using legacy unencrypted credentials format');
      return encryptedData;
    } catch {
      throw new Error('Invalid credentials format');
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { output_id } = await req.json();

    if (!output_id) {
      return new Response(
        JSON.stringify({ error: 'output_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get output with pending predictions
    const { data: output, error: fetchError } = await supabase
      .from('content_outputs')
      .select('*')
      .eq('id', output_id)
      .single();

    if (fetchError || !output) {
      return new Response(
        JSON.stringify({ error: 'Output not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let pendingPredictions = output.generation_params?.pending_predictions || [];

    // Also find orphaned scenes/slides/clips that are stuck in "generating" but not in pending_predictions
    // This can happen due to race conditions in webhook processing
    let stageData = output.stage_data || {};
    const orphanedPredictions: any[] = [];
    const pendingPredictionIds = new Set(pendingPredictions.map((p: any) => p.prediction_id));

    for (const [stageId, stageContent] of Object.entries(stageData)) {
      const content = stageContent as any;

      // Check scenes (storyboard)
      if (content?.scenes) {
        for (const scene of content.scenes) {
          if (scene.status === 'generating' && scene.prediction_id && !pendingPredictionIds.has(scene.prediction_id)) {
            console.log(`Found orphaned scene ${scene.scene_number} with prediction ${scene.prediction_id}`);
            orphanedPredictions.push({
              prediction_id: scene.prediction_id,
              stage_id: stageId,
              item_type: 'image',
              scene_number: scene.scene_number,
            });
          }
        }
      }

      // Check slides (carousel)
      if (content?.slides) {
        for (const slide of content.slides) {
          if (slide.status === 'generating' && slide.prediction_id && !pendingPredictionIds.has(slide.prediction_id)) {
            console.log(`Found orphaned slide ${slide.slide_number} with prediction ${slide.prediction_id}`);
            orphanedPredictions.push({
              prediction_id: slide.prediction_id,
              stage_id: stageId,
              item_type: 'carousel_slide',
              scene_number: slide.slide_number,
            });
          }
        }
      }

      // Check clips (video)
      if (content?.clips) {
        for (const clip of content.clips) {
          if (clip.status === 'generating' && clip.prediction_id && !pendingPredictionIds.has(clip.prediction_id)) {
            console.log(`Found orphaned clip ${clip.scene_number} with prediction ${clip.prediction_id}`);
            orphanedPredictions.push({
              prediction_id: clip.prediction_id,
              stage_id: stageId,
              item_type: 'clip',
              scene_number: clip.scene_number,
            });
          }
        }
      }
    }

    // Merge orphaned predictions with pending predictions
    pendingPredictions = [...pendingPredictions, ...orphanedPredictions];

    if (pendingPredictions.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No pending predictions', updated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Checking ${pendingPredictions.length} predictions (${orphanedPredictions.length} orphaned)`);

    // Get organization_id for storage upload
    const organizationId = output.organization_id;

    // Get Replicate API key directly from organization_id
    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organizationId)
      .eq('provider', 'replicate')
      .single();

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'No Replicate API key found' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt API key using same method as execute-stage
    const encryptionKeyHex = Deno.env.get('ENCRYPTION_KEY')!;
    const keyBytes = new Uint8Array(
      encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );
    const encryptedData = Uint8Array.from(atob(apiKey.key_encrypted), c => c.charCodeAt(0));
    const iv = encryptedData.slice(0, 12);
    const ciphertext = encryptedData.slice(12);
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
    const replicateApiKey = new TextDecoder().decode(decrypted);

    // Check each prediction status
    let updatedCount = 0;
    // stageData already declared above when checking for orphaned predictions
    const completedPredictionIds: string[] = [];

    for (const prediction of pendingPredictions) {
      try {
        const statusResponse = await fetch(
          `https://api.replicate.com/v1/predictions/${prediction.prediction_id}`,
          { headers: { Authorization: `Bearer ${replicateApiKey}` } }
        );

        if (!statusResponse.ok) continue;

        const predictionData = await statusResponse.json();
        const { status, output: predictionOutput, error: predictionError } = predictionData;

        // Only update if prediction has finished (succeeded or failed)
        if (status === 'succeeded' || status === 'failed') {
          const { stage_id, item_type, scene_number } = prediction;
          const friendlyError = status === 'failed' ? parseReplicateError(predictionError) : null;

          // Update stage_data based on item type
          if (item_type === 'carousel_slide') {
            const currentSlides = stageData[stage_id]?.slides || [];
            const imageUrl = Array.isArray(predictionOutput) ? predictionOutput[0] : predictionOutput;

            // Upload to permanent storage if succeeded
            let permanentUrl = imageUrl;
            if (status === 'succeeded' && imageUrl) {
              try {
                permanentUrl = await uploadToStorage(supabase, organizationId, imageUrl, 'image', output_id);
                console.log(`✅ Carousel slide image uploaded to storage: ${permanentUrl}`);
              } catch (uploadError) {
                console.error('⚠️ Storage upload failed, using temporary URL:', uploadError);
              }
            }

            const updatedSlides = currentSlides.map((slide: any) =>
              slide.slide_number === scene_number
                ? {
                    ...slide,
                    status: status === 'succeeded' ? 'pending' : 'failed',
                    image_url: status === 'succeeded' ? permanentUrl : undefined,
                    error: friendlyError,
                    completed_at: new Date().toISOString()
                  }
                : slide
            );

            stageData[stage_id] = {
              ...stageData[stage_id],
              slides: updatedSlides
            };
          } else if (item_type === 'clip') {
            const currentClips = stageData[stage_id]?.clips || [];

            // Upload to permanent storage if succeeded
            let permanentUrl = predictionOutput;
            if (status === 'succeeded' && predictionOutput) {
              try {
                permanentUrl = await uploadToStorage(supabase, organizationId, predictionOutput, 'video', output_id);
                console.log(`✅ Clip uploaded to storage: ${permanentUrl}`);
              } catch (uploadError) {
                console.error('⚠️ Storage upload failed, using temporary URL:', uploadError);
              }
            }

            const updatedClips = currentClips.map((clip: any) =>
              clip.scene_number === scene_number
                ? {
                    ...clip,
                    status: status === 'succeeded' ? 'pending' : 'failed',
                    video_url: status === 'succeeded' ? permanentUrl : undefined,
                    error: friendlyError,
                    completed_at: new Date().toISOString()
                  }
                : clip
            );

            stageData[stage_id] = {
              ...stageData[stage_id],
              clips: updatedClips
            };
          } else if (item_type === 'image') {
            const currentScenes = stageData[stage_id]?.scenes || [];
            const imageUrl = Array.isArray(predictionOutput) ? predictionOutput[0] : predictionOutput;

            // Upload to permanent storage if succeeded
            let permanentUrl = imageUrl;
            if (status === 'succeeded' && imageUrl) {
              try {
                permanentUrl = await uploadToStorage(supabase, organizationId, imageUrl, 'image', output_id);
                console.log(`✅ Image uploaded to storage: ${permanentUrl}`);
              } catch (uploadError) {
                console.error('⚠️ Storage upload failed, using temporary URL:', uploadError);
              }
            }

            const updatedScenes = currentScenes.map((scene: any) =>
              scene.scene_number === scene_number
                ? {
                    ...scene,
                    status: status === 'succeeded' ? 'pending' : 'failed',
                    image_url: status === 'succeeded' ? permanentUrl : undefined,
                    error: friendlyError,
                    completed_at: new Date().toISOString()
                  }
                : scene
            );

            stageData[stage_id] = {
              ...stageData[stage_id],
              scenes: updatedScenes
            };
          } else if (item_type === 'video' || item_type === 'assembly') {
            // Handle single video or assembly completion
            const videoUrl = Array.isArray(predictionOutput) ? predictionOutput[0] : predictionOutput;

            // Upload to permanent storage if succeeded
            let permanentUrl = videoUrl;
            if (status === 'succeeded' && videoUrl) {
              try {
                permanentUrl = await uploadToStorage(supabase, organizationId, videoUrl, 'video', output_id);
                console.log(`✅ Video uploaded to storage: ${permanentUrl}`);
              } catch (uploadError) {
                console.error('⚠️ Storage upload failed, using temporary URL:', uploadError);
              }
            }

            stageData[stage_id] = {
              ...stageData[stage_id],
              url: status === 'succeeded' ? permanentUrl : undefined,
              video_url: status === 'succeeded' ? permanentUrl : undefined,
              status: status === 'succeeded' ? 'pending' : 'failed',
              error: friendlyError,
              completed_at: new Date().toISOString()
            };
          }

          completedPredictionIds.push(prediction.prediction_id);
          updatedCount++;
        }
      } catch (error) {
        console.error(`Failed to check prediction ${prediction.prediction_id}:`, error);
      }
    }

    // Update database if any predictions were updated
    if (updatedCount > 0) {
      // Remove completed predictions from pending list
      const remainingPredictions = pendingPredictions.filter(
        (p: any) => !completedPredictionIds.includes(p.prediction_id)
      );

      await supabase.from('content_outputs').update({
        stage_data: stageData,
        generation_params: {
          ...output.generation_params,
          pending_predictions: remainingPredictions
        }
      }).eq('id', output_id);
    }

    return new Response(
      JSON.stringify({
        message: `Checked ${pendingPredictions.length} predictions`,
        updated: updatedCount
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error checking prediction status:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function uploadToStorage(
  supabase: any,
  organizationId: string,
  temporaryUrl: string,
  mediaType: 'image' | 'video',
  outputId: string
): Promise<string> {
  // Get organization's storage credentials
  const { data: credentials } = await supabase
    .from('storage_credentials')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .single();

  if (!credentials) {
    // Self-hosted: the shared module stores it in the install's own Supabase Storage.
    if (SELF_HOSTED) return await uploadToByokStorage(supabase, organizationId, temporaryUrl, mediaType, outputId);
    throw new Error('No active storage credentials found');
  }

  // Decrypt and parse the credentials
  let parsedCreds: any;
  try {
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    // Check if credentials are encrypted (hex:hex:hex format) or plain JSON
    const credValue = credentials.credentials_encrypted;
    if (credValue.includes(':') && !credValue.startsWith('{')) {
      // Encrypted format: ivHex:authTagHex:encryptedHex
      const decryptedJson = await decryptCredentials(credValue, encryptionKey);
      parsedCreds = JSON.parse(decryptedJson);
      console.log(`📦 Decrypted credentials for ${credentials.provider}`);
    } else {
      // Plain JSON format (legacy)
      parsedCreds = JSON.parse(credValue);
      console.log(`📦 Parsed plain credentials for ${credentials.provider}`);
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Unknown error';
    throw new Error(`Failed to decrypt/parse storage credentials: ${errorMsg}`);
  }

  // Download the file from temporary URL
  console.log(`⬇️ Downloading ${mediaType} from ${temporaryUrl}`);
  const response = await fetch(temporaryUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${mediaType}: ${response.statusText}`);
  }
  const fileBlob = await response.blob();

  // Generate storage path
  const extension = mediaType === 'video' ? 'mp4' : 'png';
  const timestamp = Date.now();
  const filename = `${outputId}_${timestamp}.${extension}`;
  const storagePath = `content-outputs/${mediaType}s/${filename}`;

  // Upload to appropriate storage provider
  let publicUrl: string;

  if (credentials.provider === 'cloudflare_r2') {
    publicUrl = await uploadToCloudflareR2(credentials, parsedCreds, storagePath, fileBlob, mediaType);
  } else if (credentials.provider === 'backblaze_b2') {
    publicUrl = await uploadToBackblazeB2(credentials, parsedCreds, storagePath, fileBlob, mediaType);
  } else if (credentials.provider === 'aws_s3') {
    publicUrl = await uploadToAwsS3(credentials, parsedCreds, storagePath, fileBlob, mediaType);
  } else {
    throw new Error(`Unsupported storage provider: ${credentials.provider}`);
  }

  console.log(`✅ Uploaded to ${credentials.provider}: ${publicUrl}`);
  return publicUrl;
}

async function uploadToCloudflareR2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  mediaType: string
): Promise<string> {
  const accountId = parsedCreds.accountId;
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const accessKeyId = parsedCreds.accessKeyId;
  const secretAccessKey = parsedCreds.secretAccessKey;

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    throw new Error(`Missing R2 credentials: accountId=${!!accountId}, bucket=${!!bucketName}, key=${!!accessKeyId}, secret=${!!secretAccessKey}`);
  }

  // AWS Signature V4 implementation for R2
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${bucketName}/${path}`;
  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/webp';
  const region = 'auto';
  const service = 's3';
  const method = 'PUT';

  // Create date strings
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  // Hash the payload
  const encoder = new TextEncoder();
  const payloadBytes = new Uint8Array(await data.arrayBuffer());
  const payloadHash = await sha256Hex(payloadBytes);

  // Create canonical request
  const canonicalUri = `/${bucketName}/${path}`;
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
  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  // Create authorization header
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  console.log(`⬆️ Uploading to R2: ${url}`);

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
    console.error(`❌ R2 upload failed (${response.status}):`, errorText);
    throw new Error(`R2 upload failed: ${response.status} - ${response.statusText} - ${errorText}`);
  }

  console.log(`✅ R2 upload succeeded!`);

  // Use public_url from top-level column
  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

async function uploadToBackblazeB2(
  credentials: any,
  parsedCreds: any,
  path: string,
  data: Blob,
  mediaType: string
): Promise<string> {
  const keyId = parsedCreds.keyId;
  const applicationKey = parsedCreds.applicationKey;
  const bucketId = parsedCreds.bucketId;

  // Authorize
  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      'Authorization': `Basic ${btoa(`${keyId}:${applicationKey}`)}`,
    },
  });
  const authData = await authResponse.json();

  // Get upload URL
  const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      'Authorization': authData.authorizationToken,
    },
    body: JSON.stringify({ bucketId }),
  });
  const uploadUrlData = await uploadUrlResponse.json();

  // Upload file
  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/png';
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
  mediaType: string
): Promise<string> {
  const accessKeyId = parsedCreds.accessKeyId;
  const secretAccessKey = parsedCreds.secretAccessKey;
  const bucketName = credentials.bucket_name || parsedCreds.bucketName;
  const region = parsedCreds.region || 'us-east-1';

  // AWS Signature V4 implementation for S3
  // For S3 virtual-hosted style, bucket is in the hostname
  const host = `${bucketName}.s3.${region}.amazonaws.com`;
  const url = `https://${host}/${path}`;
  const contentType = mediaType === 'video' ? 'video/mp4' : 'image/webp';
  const service = 's3';
  const method = 'PUT';

  // Create date strings
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  // Hash the payload
  const encoder = new TextEncoder();
  const payloadBytes = new Uint8Array(await data.arrayBuffer());
  const payloadHash = await sha256Hex(payloadBytes);

  // Create canonical request
  const canonicalUri = `/${path}`;
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
  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  // Create authorization header
  const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  console.log(`⬆️ Uploading to S3: ${url}`);

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
    console.error(`❌ S3 upload failed (${response.status}):`, errorText);
    throw new Error(`S3 upload failed: ${response.status} - ${response.statusText} - ${errorText}`);
  }

  return credentials.public_url ? `${credentials.public_url}/${path}` : url;
}

function parseReplicateError(error: string): string {
  if (!error) return 'Generation failed';

  if (error.includes('E005') || error.includes('flagged as sensitive') || error.includes('content moderation')) {
    return 'Content flagged: Your prompt contains content filtered by AI safety systems. Try rephrasing - avoid terms like "Clone", "deepfake", or celebrity names.';
  }

  if (error.includes('NSFW')) {
    return 'NSFW content detected: Please use appropriate content in your prompts.';
  }

  if (error.includes('timeout') || error.includes('timed out')) {
    return 'Generation timed out: The model took too long to respond. Try again or use a shorter prompt.';
  }

  if (error.includes('out of memory') || error.includes('OOM')) {
    return 'Out of memory: Try reducing image resolution or video duration.';
  }

  if (error.includes('429') || error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('too many requests')) {
    return 'Rate limit reached: Too many requests to the AI service. Please wait a moment and try again.';
  }

  return error.length > 200 ? `${error.substring(0, 200)}...` : error;
}
