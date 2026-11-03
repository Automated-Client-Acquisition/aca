import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { buildAuthHeader } from "../_shared/twitter-oauth.ts";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

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
  const ciphertext = encryptedArray.slice(0, -16);
  const authTag = encryptedArray.slice(-16);

  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  const authTagHex = Array.from(authTag).map(b => b.toString(16).padStart(2, '0')).join('');
  const encryptedHex = Array.from(ciphertext).map(b => b.toString(16).padStart(2, '0')).join('');

  return `${ivHex}:${authTagHex}:${encryptedHex}`;
}

// Decrypt credentials
async function decryptCredentials(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  const [ivHex, authTagHex, encryptedHex] = encryptedData.split(':');

  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const authTag = new Uint8Array(authTagHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const ciphertext = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

  const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

  if (!encryptionKey) {
    return new Response(JSON.stringify({ success: false, error: 'ENCRYPTION_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const {
      organization_id,
      account_id,
      name,
      consumer_key,
      consumer_secret,
      access_token,
      access_token_secret,
      test_only,
    } = body;

    let consumerKey: string;
    let consumerSecret: string;
    let accessToken: string;
    let accessTokenSecret: string;

    if (test_only && account_id) {
      // Re-test existing account: decrypt stored credentials
      const { data: account, error: fetchError } = await supabase
        .from('twitter_accounts')
        .select('*')
        .eq('id', account_id)
        .single();

      if (fetchError || !account) {
        return new Response(JSON.stringify({ success: false, error: 'Account not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // The service-role client acts on whatever row the body names, so the caller
      // must be able to access that row's org (a valid anon-key JWT alone is not enough).
      try { await assertOrgAccess(req, supabase, account.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

      consumerKey = await decryptCredentials(account.consumer_key_encrypted, encryptionKey);
      consumerSecret = await decryptCredentials(account.consumer_secret_encrypted, encryptionKey);
      accessToken = await decryptCredentials(account.access_token_encrypted, encryptionKey);
      accessTokenSecret = await decryptCredentials(account.access_token_secret_encrypted, encryptionKey);
    } else {
      // New save: validate required fields
      if (!organization_id || !consumer_key || !consumer_secret || !access_token || !access_token_secret) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Missing required fields: organization_id, consumer_key, consumer_secret, access_token, access_token_secret'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (account_id) {
        const { data: existing } = await supabase
          .from('twitter_accounts')
          .select('organization_id')
          .eq('id', account_id)
          .maybeSingle();

        if (!existing) {
          return new Response(JSON.stringify({ success: false, error: 'Account not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // The service-role client acts on whatever row the body names, so the caller
        // must be able to access that row's org (a valid anon-key JWT alone is not enough).
        try { await assertOrgAccess(req, supabase, existing.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

        // An update never moves the account to another organization.
        if (existing.organization_id !== organization_id) {
          return new Response(JSON.stringify({ success: false, error: 'organization_id does not match the account' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        // A new account is saved under the body's organization_id, so the caller must be able to access it.
        try { await assertOrgAccess(req, supabase, organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }
      }

      consumerKey = consumer_key;
      consumerSecret = consumer_secret;
      accessToken = access_token;
      accessTokenSecret = access_token_secret;
    }

    // Test the connection by fetching the authenticated user
    const testUrl = 'https://api.twitter.com/2/users/me';
    const queryParams = 'user.fields=profile_image_url,username';
    const fullUrl = `${testUrl}?${queryParams}`;

    // Parse query params for OAuth signing
    const params: Record<string, string> = {};
    for (const pair of queryParams.split('&')) {
      const [k, v] = pair.split('=');
      params[k] = v;
    }

    const authHeader = await buildAuthHeader(
      'GET',
      testUrl,
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret,
      params
    );

    const testResponse = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
    });

    if (!testResponse.ok) {
      const errorBody = await testResponse.text();
      console.error('Twitter API test failed:', testResponse.status, errorBody);

      const errorMsg = testResponse.status === 401
        ? 'Invalid credentials. Check your API keys and tokens.'
        : testResponse.status === 403
          ? 'Access forbidden. Ensure your app has Read and Write permissions.'
          : testResponse.status === 402
            ? 'X API credits depleted. Top up at console.x.com.'
            : `Twitter API error (${testResponse.status})`;

      // If re-testing, update the account as invalid
      if (test_only && account_id) {
        await supabase.from('twitter_accounts').update({
          is_valid: false,
          error_message: errorMsg,
          last_tested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', account_id);
      }

      return new Response(JSON.stringify({ success: false, error: errorMsg }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userData = await testResponse.json();
    const twitterHandle = userData.data?.username || null;
    const twitterUserId = userData.data?.id || null;
    const profileImageUrl = userData.data?.profile_image_url || null;

    console.log(`Twitter auth successful: @${twitterHandle} (${twitterUserId})`);

    // Verify write access by sending an empty tweet — 403 = no write permission, 400 = write allowed
    let hasWriteAccess = true;
    let writeErrorMsg: string | null = null;
    try {
      const writeTestUrl = 'https://api.twitter.com/2/tweets';
      const writeAuthHeader = await buildAuthHeader(
        'POST', writeTestUrl,
        consumerKey, consumerSecret,
        accessToken, accessTokenSecret
      );

      const writeTestResponse = await fetch(writeTestUrl, {
        method: 'POST',
        headers: {
          'Authorization': writeAuthHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: '' }),
      });

      if (writeTestResponse.status === 403) {
        hasWriteAccess = false;
        const errorBody = await writeTestResponse.text();
        console.error('Twitter write access denied (403):', errorBody);
        writeErrorMsg = 'App lacks write permissions. In the Twitter Developer Portal, set User Authentication to Read and Write, then regenerate your Access Token & Secret.';
      } else {
        console.log(`Twitter write access confirmed (status ${writeTestResponse.status} for empty tweet test)`);
      }
    } catch (err) {
      console.warn('Write access check failed (network):', err);
    }

    if (!hasWriteAccess) {
      if ((test_only && account_id) || account_id) {
        await supabase.from('twitter_accounts').update({
          is_valid: false,
          error_message: writeErrorMsg,
          last_tested_at: new Date().toISOString(),
          twitter_handle: twitterHandle,
          twitter_user_id: twitterUserId,
          profile_image_url: profileImageUrl,
          updated_at: new Date().toISOString(),
        }).eq('id', account_id);
      }

      return new Response(JSON.stringify({ success: false, error: writeErrorMsg }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (test_only && account_id) {
      // Update existing account status
      await supabase.from('twitter_accounts').update({
        is_valid: true,
        error_message: null,
        last_tested_at: new Date().toISOString(),
        twitter_handle: twitterHandle,
        twitter_user_id: twitterUserId,
        profile_image_url: profileImageUrl,
        updated_at: new Date().toISOString(),
      }).eq('id', account_id);

      return new Response(JSON.stringify({
        success: true,
        account_id: account_id,
        twitter_handle: twitterHandle,
        twitter_user_id: twitterUserId,
        profile_image_url: profileImageUrl,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Encrypt all credentials
    const [
      consumerKeyEncrypted,
      consumerSecretEncrypted,
      accessTokenEncrypted,
      accessTokenSecretEncrypted,
    ] = await Promise.all([
      encryptCredentials(consumerKey, encryptionKey),
      encryptCredentials(consumerSecret, encryptionKey),
      encryptCredentials(accessToken, encryptionKey),
      encryptCredentials(accessTokenSecret, encryptionKey),
    ]);

    const accountData = {
      organization_id,
      name: name || `@${twitterHandle}` || 'Twitter Account',
      twitter_handle: twitterHandle,
      twitter_user_id: twitterUserId,
      profile_image_url: profileImageUrl,
      consumer_key_encrypted: consumerKeyEncrypted,
      consumer_secret_encrypted: consumerSecretEncrypted,
      access_token_encrypted: accessTokenEncrypted,
      access_token_secret_encrypted: accessTokenSecretEncrypted,
      is_active: true,
      is_valid: true,
      last_tested_at: new Date().toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    };

    let resultId: string;

    if (account_id) {
      // Update existing account
      const { error: updateError } = await supabase
        .from('twitter_accounts')
        .update(accountData)
        .eq('id', account_id);

      if (updateError) throw updateError;
      resultId = account_id;
    } else {
      // Insert new account
      const { data: newAccount, error: insertError } = await supabase
        .from('twitter_accounts')
        .insert(accountData)
        .select('id')
        .single();

      if (insertError) throw insertError;
      resultId = newAccount.id;
    }

    return new Response(JSON.stringify({
      success: true,
      account_id: resultId,
      twitter_handle: twitterHandle,
      twitter_user_id: twitterUserId,
      profile_image_url: profileImageUrl,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('validate-twitter error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
