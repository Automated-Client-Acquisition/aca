import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Decrypt API key using AES-256-GCM
async function decryptApiKey(encryptedKey: string, encryptionKeyHex: string): Promise<string> {
  try {
    const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const combined = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decryptedBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt API key');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Create service role client for database operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user authentication
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized');

    const { runId } = await req.json();
    if (!runId) throw new Error('Missing runId');

    console.log(`Aborting scrape run: ${runId}`);

    // Get scrape run details
    const { data: scrapeRun, error: runError } = await supabaseAdmin
      .from('research_scrape_runs')
      .select('organization_id, apify_run_id')
      .eq('run_id', runId)
      .single();

    if (runError || !scrapeRun) throw new Error('Scrape run not found');
    if (!scrapeRun.apify_run_id) throw new Error('No Apify run ID found');

    // Get organization's Apify API key
    const { data: apiKey, error: keyError } = await supabaseAdmin
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', scrapeRun.organization_id)
      .eq('provider', 'apify')
      .single();

    if (keyError || !apiKey) throw new Error('Apify API key not found');

    // Decrypt the API key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) throw new Error('Encryption key not configured');
    
    const apifyToken = await decryptApiKey(apiKey.key_encrypted, encryptionKey);

    // Abort the Apify run
    const abortResponse = await fetch(
      `https://api.apify.com/v2/acts/runs/${scrapeRun.apify_run_id}/abort`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apifyToken}`,
        },
      }
    );

    if (!abortResponse.ok) {
      const error = await abortResponse.text();
      console.error('Failed to abort Apify run:', error);
      throw new Error('Failed to abort scrape on Apify');
    }

    // Update scrape run status
    const { error: updateError } = await supabaseAdmin
      .from('research_scrape_runs')
      .update({
        status: 'ABORTED',
        finished_at: new Date().toISOString(),
        error_message: 'Manually aborted by user',
      })
      .eq('run_id', runId);

    if (updateError) {
      console.error('Failed to update scrape run status:', updateError);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Scrape aborted successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error aborting scrape:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to abort scrape' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
