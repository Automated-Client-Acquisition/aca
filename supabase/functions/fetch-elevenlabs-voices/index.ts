import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const { data: userData, error: userDataError } = await supabaseClient
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();

    if (userDataError) {
      console.error('Organization fetch error:', userDataError);
      throw userDataError;
    }

    const orgId = userData.active_organization_id || userData.organization_id;

    // Get ElevenLabs API key
    const { data: apiKeyData, error: apiKeyError } = await supabaseClient
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'elevenlabs')
      .eq('is_valid', true)
      .single();

    if (apiKeyError || !apiKeyData) {
      console.error('API key fetch error:', apiKeyError);
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

    console.log('Fetching ElevenLabs voices...');

    // Fetch voices from ElevenLabs
    const voicesResponse = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!voicesResponse.ok) {
      const errorText = await voicesResponse.text();
      console.error('ElevenLabs API error:', voicesResponse.status, errorText);

      let providerMessage = '';
      try {
        const parsed = JSON.parse(errorText);
        providerMessage = parsed?.detail?.message || parsed?.detail?.status || parsed?.message || '';
      } catch { /* not JSON — fall through to the generic text below */ }

      // A revoked/expired/mistyped key answers every call the same way
      // forever (ElevenLabs uses plain 401 for a dead key, but 400 for a
      // key that doesn't even parse as one - e.g. a Key ID pasted where the
      // secret key belongs, since GET /v1/voices takes no params of its own
      // that could otherwise produce a 400). Nothing else in this org's flow
      // ever flips is_valid back to false, so without this,
      // hasElevenLabsKey in useElevenLabsVoices stays true forever and the
      // UI keeps retrying a key that can never succeed.
      if (voicesResponse.status === 401 || voicesResponse.status === 400) {
        await supabaseClient
          .from('api_keys')
          .update({ is_valid: false })
          .eq('organization_id', orgId)
          .eq('provider', 'elevenlabs');

        return new Response(
          JSON.stringify({ error: `ElevenLabs rejected this API key${providerMessage ? `: ${providerMessage}` : '.'} Please re-add a valid key (starts with "sk_") in Settings.` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const reason = voicesResponse.status === 429
        ? 'Rate limited by ElevenLabs'
        : `ElevenLabs API error ${voicesResponse.status}${providerMessage ? ` - ${providerMessage}` : ''}`;
      return new Response(
        JSON.stringify({ error: reason }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const voicesData = await voicesResponse.json();

    return new Response(
      JSON.stringify({ voices: voicesData.voices }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error fetching ElevenLabs voices:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

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
