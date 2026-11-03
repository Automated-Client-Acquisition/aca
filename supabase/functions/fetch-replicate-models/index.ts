import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decrypt API key using AES-256-GCM
async function decryptApiKey(encryptedKey: string, encryptionKeyHex: string): Promise<string> {
  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const combined = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}

interface ReplicateModel {
  url: string;
  owner: string;
  name: string;
  description: string | null;
  visibility: string;
  github_url: string | null;
  paper_url: string | null;
  license_url: string | null;
  run_count: number;
  cover_image_url: string | null;
  default_example: any;
  latest_version: {
    id: string;
    created_at: string;
    cog_version: string;
    openapi_schema: any;
  } | null;
}

function categorizeModel(model: ReplicateModel): string[] {
  const categories: string[] = [];
  const searchText = `${model.name} ${model.description || ''} ${model.owner}`.toLowerCase();

  // Text-to-Image
  if (searchText.match(/text.to.image|image.generation|flux|sdxl|stable.diffusion|dall.?e|midjourney|imagen|t2i|playground|ideogram|recraft/)) {
    categories.push('text-to-image');
  }

  // Image-to-Video
  if (searchText.match(/image.to.video|i2v|runway|pika|luma|kling|animate|seedance|haiper|hailuo|PixVerse|morph|video.from.image|img2vid/)) {
    categories.push('image-to-video');
  }

  // Text-to-Video
  if (searchText.match(/text.to.video|t2v|video.generation|sora|veo|world|runway.gen|gen.4|mochi|genmo|cogvideo|hunyuan/)) {
    categories.push('text-to-video');
  }

  return categories;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get user from JWT token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      throw new Error('Unauthorized');
    }

    console.log('Authenticated user:', user.id);

    // Get user's organization
    const { data: userData, error: orgError } = await supabaseClient
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();

    if (orgError) {
      console.error('Organization fetch error:', orgError);
      throw orgError;
    }
    const orgId = userData.active_organization_id || userData.organization_id;

    // Get Replicate API key
    const { data: apiKeyData, error: keyError } = await supabaseClient
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'replicate')
      .eq('is_valid', true)
      .single();

    if (keyError || !apiKeyData) {
      console.error('API key fetch error:', keyError);
      return new Response(
        JSON.stringify({ error: 'No valid Replicate API key found. Please add a Replicate API key in Settings.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate encrypted key format
    if (!apiKeyData.key_encrypted || typeof apiKeyData.key_encrypted !== 'string') {
      console.error('Invalid encrypted key format:', apiKeyData.key_encrypted);
      return new Response(
        JSON.stringify({ error: 'Invalid API key format. Please re-add your Replicate API key.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt API key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) throw new Error('ENCRYPTION_KEY not configured');
    
    let apiKey: string;
    try {
      apiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    } catch (decryptError) {
      console.error('Decryption error:', decryptError);
      return new Response(
        JSON.stringify({ error: 'Failed to decrypt API key. Please re-add your Replicate API key in Settings.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body for optional filtering
    const body = await req.json().catch(() => ({}));
    const requestedCategory = body.category as string | undefined;

    console.log('Fetching Replicate models...', requestedCategory ? `for category: ${requestedCategory}` : '');

    // Use category-specific collection endpoints when possible for better results
    let collectionSlug: string | null = null;
    if (requestedCategory === 'text-to-image') {
      collectionSlug = 'text-to-image';
    } else if (requestedCategory === 'image-to-video') {
      collectionSlug = 'video-generation';
    } else if (requestedCategory === 'text-to-video') {
      collectionSlug = 'video-generation';
    }

    const allModels: ReplicateModel[] = [];
    
    if (collectionSlug) {
      // Fetch from collection endpoint
      const collectionResponse = await fetch(`https://api.replicate.com/v1/collections/${collectionSlug}`, {
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (collectionResponse.ok) {
        const collectionData = await collectionResponse.json();
        if (collectionData.models) {
          allModels.push(...collectionData.models);
        }
      }
    }
    
    // Also fetch from general models endpoint to get more options
    const response = await fetch('https://api.replicate.com/v1/models', {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate API error:', response.status, errorText);
      throw new Error(`Replicate API error: ${response.status}`);
    }

    const data = await response.json();
    if (data.results) {
      allModels.push(...data.results);
    }
    
    // Remove duplicates by model id
    const uniqueModels = Array.from(
      new Map(allModels.map(m => [`${m.owner}/${m.name}`, m])).values()
    ) as ReplicateModel[];

    const models = uniqueModels;

    console.log(`Fetched ${models.length} models from Replicate`);

    // Categorize and filter models
    const categorizedModels = models
      .map(model => {
        const categories = categorizeModel(model);
        return {
          id: `${model.owner}/${model.name}`,
          name: model.name,
          displayName: `${model.owner}/${model.name}`,
          owner: model.owner,
          description: model.description,
          categories,
          runCount: model.run_count,
          coverImage: model.cover_image_url,
        };
      })
      .filter(model => model.categories.length > 0); // Only include categorized models

    // Filter by requested category if provided
    let filteredModels = categorizedModels;
    if (requestedCategory) {
      filteredModels = categorizedModels.filter(m => 
        m.categories.includes(requestedCategory)
      );
      console.log(`Filtered to ${filteredModels.length} ${requestedCategory} models`);
    }

    // Sort by popularity (run count)
    filteredModels.sort((a, b) => b.runCount - a.runCount);

    // Limit to top 50 models per category to avoid overwhelming the UI
    const limitedModels = filteredModels.slice(0, 50);

    return new Response(
      JSON.stringify({ 
        models: limitedModels,
        total: filteredModels.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in fetch-replicate-models:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Failed to fetch models' 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
