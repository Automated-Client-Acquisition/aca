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

interface ElevenLabsModel {
  model_id: string;
  name: string;
  description?: string;
  can_be_finetuned: boolean;
  can_do_text_to_speech: boolean;
  can_do_voice_conversion: boolean;
  can_use_style: boolean;
  can_use_speaker_boost: boolean;
  serves_pro_voices: boolean;
  token_cost_factor: number;
  languages?: Array<{
    language_id: string;
    name: string;
  }>;
  max_characters_request_free_user?: number;
  max_characters_request_subscribed_user?: number;
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

    // Get ElevenLabs API key
    const { data: apiKeyData, error: keyError } = await supabaseClient
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'elevenlabs')
      .eq('is_valid', true)
      .single();

    if (keyError || !apiKeyData) {
      console.error('API key fetch error:', keyError);
      return new Response(
        JSON.stringify({ error: 'No valid ElevenLabs API key found. Please add an ElevenLabs API key in Settings.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate encrypted key format
    if (!apiKeyData.key_encrypted || typeof apiKeyData.key_encrypted !== 'string') {
      console.error('Invalid encrypted key format:', apiKeyData.key_encrypted);
      return new Response(
        JSON.stringify({ error: 'Invalid API key format. Please re-add your ElevenLabs API key.' }),
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
        JSON.stringify({ error: 'Failed to decrypt API key. Please re-add your ElevenLabs API key in Settings.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching ElevenLabs models...');

    // Fetch models from ElevenLabs
    const response = await fetch('https://api.elevenlabs.io/v1/models', {
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs API error:', response.status, errorText);
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const models = await response.json() as ElevenLabsModel[];

    console.log(`Fetched ${models.length} models from ElevenLabs`);

    // Filter to only TTS-capable models and format for frontend
    const ttsModels = models
      .filter(model => model.can_do_text_to_speech)
      .map(model => ({
        id: model.model_id,
        name: model.name,
        description: model.description,
        canBeFinetuned: model.can_be_finetuned,
        canUseStyle: model.can_use_style,
        canUseSpeakerBoost: model.can_use_speaker_boost,
        servesProVoices: model.serves_pro_voices,
        tokenCostFactor: model.token_cost_factor,
        languages: model.languages?.map(l => l.name) || [],
        maxCharactersRequestFreeUser: model.max_characters_request_free_user,
        maxCharactersRequestSubscribedUser: model.max_characters_request_subscribed_user,
      }));

    return new Response(
      JSON.stringify({ 
        models: ttsModels,
        total: ttsModels.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in fetch-elevenlabs-models:', error);
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
