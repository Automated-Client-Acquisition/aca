import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Library tables a blueprint slot may point at (LibraryElementType in src/types/blueprint.ts).
// Every one is org-scoped via organization_id.
const LIBRARY_TABLES = new Set([
  'library_brand_voices',
  'library_characters',
  'library_blocks',
  'library_products',
  'library_icps',
  'library_images',
]);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { blueprintId, slotValues, context } = await req.json();

    console.log('[Test Blueprint] Request:', { blueprintId, slotValues, context });

    // Get the blueprint
    const { data: blueprint, error: blueprintError } = await supabase
      .from('blueprints')
      .select('*')
      .eq('id', blueprintId)
      .single();

    if (blueprintError || !blueprint) {
      return new Response(
        JSON.stringify({ success: false, error: 'Blueprint not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, blueprint.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // Get organization's API key for the provider
    const provider = blueprint.model_config.text_llm?.provider || 
                     blueprint.model_config.provider || 
                     'openrouter';
    
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('key_encrypted, provider')
      .eq('organization_id', blueprint.organization_id)
      .eq('provider', provider)
      .eq('is_valid', true)
      .single();

    if (keyError || !apiKey) {
      throw new Error(`No valid ${provider} API key found`);
    }

    // Decrypt the API key
    const ENCRYPTION_KEY = Deno.env.get('ENCRYPTION_KEY');
    if (!ENCRYPTION_KEY) {
      throw new Error('Encryption key not configured');
    }

    const decryptedKey = await decryptApiKey(apiKey.key_encrypted, ENCRYPTION_KEY);

    // Fetch library elements for slot values that are IDs
    const libraryData: Record<string, any> = {};
    
    for (const [slotKey, elementId] of Object.entries(slotValues as Record<string, string>)) {
      if (!elementId) continue;
      
      // Determine library table from slot key
      const slot = blueprint.structure.slots.find((s: any) => s.key === slotKey);
      if (!slot || slot.type !== 'library_element' || !slot.library_table) continue;
      if (!LIBRARY_TABLES.has(slot.library_table)) continue;
      
      const { data: element, error } = await supabase
        .from(slot.library_table)
        .select('*')
        .eq('id', elementId)
        .eq('organization_id', blueprint.organization_id)
        .single();
      
      if (!error && element) {
        libraryData[slotKey] = element;
      }
    }

    // Resolve variables in the prompt with library element data
    let resolvedPrompt = blueprint.master_prompt;
    
    // Function to resolve nested paths like {{product.name}} or {{product.icp_pain_points}}
    const resolveVariable = (path: string): string => {
      const parts = path.trim().split('.');
      const rootKey = parts[0];
      
      if (!libraryData[rootKey]) {
        return '[Not provided]';
      }
      
      let value: any = libraryData[rootKey];
      
      // Navigate through nested path
      for (let i = 1; i < parts.length; i++) {
        if (value === null || value === undefined) {
          return '[Not provided]';
        }
        value = value[parts[i]];
      }
      
      // Format the value
      if (value === null || value === undefined) {
        return '[Not provided]';
      }
      if (Array.isArray(value)) {
        return value.join(', ');
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    };
    
    // Replace all {{variable}} patterns with resolved values
    resolvedPrompt = resolvedPrompt.replace(
      /\{\{\s*([^}]+)\s*\}\}/g,
      (_match: string, path: string) => resolveVariable(path)
    );

    // Prepend user context if provided
    if (context) {
      resolvedPrompt = `=== Additional Context ===\n${context}\n\n=== Instructions ===\n${resolvedPrompt}`;
    }

    console.log('[Test Blueprint] Resolved prompt:', resolvedPrompt);

    // Call the appropriate AI service based on provider
    let result: string;
    
    const modelId = blueprint.model_config.text_llm?.model_id || 
                    blueprint.model_config.model_id;
    const parameters = blueprint.model_config.text_llm?.parameters || 
                       blueprint.model_config.parameters || 
                       {};

    if (provider === 'openrouter') {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${decryptedKey}`,
          'HTTP-Referer': 'https://contentai.studio',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'user', content: resolvedPrompt }
          ],
          ...parameters,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${errorText}`);
      }

      const data = await response.json();
      result = data.choices[0].message.content;
    } else if (provider === 'replicate') {
      // For replicate, we'd need to start a prediction and poll for results
      // For now, return a placeholder
      result = 'Replicate integration coming soon. Your prompt is ready: ' + resolvedPrompt;
    } else {
      result = 'Provider not yet supported for testing: ' + provider;
    }

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Test Blueprint] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

async function decryptApiKey(encryptedKey: string, encryptionKeyHex: string): Promise<string> {
  try {
    // Convert hex encryption key to bytes
    const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    
    // Import the encryption key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decode base64
    const binaryString = atob(encryptedKey);
    const encryptedBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      encryptedBytes[i] = binaryString.charCodeAt(i);
    }
    
    // Extract IV (first 12 bytes) and ciphertext
    const iv = encryptedBytes.slice(0, 12);
    const ciphertext = encryptedBytes.slice(12);

    // Decrypt
    const decryptedBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Unable to decrypt API key. Please check your API key configuration.');
  }
}
