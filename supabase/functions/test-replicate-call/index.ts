import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReplicateInput {
  [key: string]: any;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const { model, input } = await req.json() as { model: string; input: ReplicateInput };

    if (!model || !input) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: model and input' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Get user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return new Response(
        JSON.stringify({ error: 'User organization not found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // Get Replicate API key
    const { data: apiKeyData, error: keyError } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', userData.organization_id)
      .eq('provider', 'replicate')
      .eq('is_valid', true)
      .single();

    if (keyError || !apiKeyData) {
      return new Response(
        JSON.stringify({ error: 'Replicate API key not found. Please add one in Settings.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    // Decrypt API key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    const decryptApiKey = async (encryptedBase64: string): Promise<string> => {
      try {
        // Decode base64
        const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        
        // Extract IV (first 12 bytes) and ciphertext (rest)
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);

        // Convert hex encryption key to bytes
        const keyBytes = new Uint8Array(encryptionKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        
        // Import the encryption key
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          keyBytes,
          { name: 'AES-GCM', length: 256 },
          false,
          ['decrypt']
        );

        // Decrypt
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          cryptoKey,
          ciphertext
        );

        return new TextDecoder().decode(decrypted);
      } catch (error) {
        console.error('Decryption error:', error);
        throw new Error('Failed to decrypt API key');
      }
    };

    const replicateApiKey = await decryptApiKey(apiKeyData.key_encrypted);

    console.log(`Calling Replicate model: ${model}`);
    console.log(`Input:`, input);

    // Call Replicate API
    const response = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${replicateApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Replicate API error (${response.status}):`, errorText);
      
      return new Response(
        JSON.stringify({ 
          error: `Replicate API error: ${response.status}`,
          details: errorText,
          status: response.status
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: response.status }
      );
    }

    const result = await response.json();
    console.log('Replicate response:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in test-replicate-call:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
