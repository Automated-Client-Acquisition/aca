import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Encrypt API key using AES-256-GCM
async function encryptApiKey(apiKey: string, encryptionKeyHex: string): Promise<string> {
  try {
    // Convert hex encryption key to bytes
    const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    
    // Import the encryption key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt
    const encryptedBytes = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      new TextEncoder().encode(apiKey)
    );

    // Combine IV and ciphertext
    const combined = new Uint8Array(iv.length + encryptedBytes.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encryptedBytes), iv.length);

    // Return as base64
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt API key');
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    let { provider, apiKey, dsnUrl, secondaryKey } = await req.json();

    console.log(`Validating ${provider} API key`);

    // Self-hosted Ollama servers may have no auth; store a sentinel so the
    // NOT NULL key_encrypted column keeps its shape.
    if (provider === 'ollama' && (!apiKey || !apiKey.trim())) {
      apiKey = 'none';
    }

    // Validate the key
    let result: any;
    switch (provider) {
      case 'openrouter':
        result = await validateOpenRouter(apiKey);
        break;
      case 'ollama':
        result = await validateOllama(apiKey, dsnUrl);
        break;
      case 'alibaba':
        result = await validateAlibaba(apiKey, dsnUrl);
        break;
      case 'openai':
        result = await validateOpenAI(apiKey);
        break;
      case 'replicate':
        result = await validateReplicate(apiKey);
        break;
      case 'elevenlabs':
        result = await validateElevenLabs(apiKey);
        break;
      case 'apify':
        result = await validateApify(apiKey);
        break;
      case 'youtube':
        result = await validateYouTube(apiKey);
        break;
      case 'fal':
        result = await validateFal(apiKey);
        break;
      case 'leadconnector':
        result = await validateGHL(apiKey);
        break;
      case 'unipile':
        result = await validateUnipile(apiKey, dsnUrl);
        break;
      case 'zernio':
        result = await validateZernio(apiKey);
        break;
      // Contact enrichment providers
      case 'apollo':
        result = await validateApollo(apiKey);
        break;
      case 'hunter':
        result = await validateHunter(apiKey);
        break;
      case 'prospeo':
        result = await validateProspeo(apiKey);
        break;
      case 'moltsets':
        result = await validateMoltsets(apiKey);
        break;
      case 'quickenrich':
        result = await validateQuickenrich(apiKey);
        break;
      // Email infrastructure
      case 'zapmail':
        result = await validateZapMail(apiKey);
        break;
      // Email verification
      case 'mailtester_ninja':
        result = await validateMailtesterNinja(apiKey);
        break;
      // UGC video
      case 'heygen':
        result = await validateHeyGen(apiKey);
        break;
      // Stock footage
      case 'pexels':
        result = await validatePexels(apiKey);
        break;
      case 'pixabay':
        result = await validatePixabay(apiKey);
        break;
      // Domain registrars
      case 'porkbun':
        result = await validatePorkbun(apiKey, secondaryKey);
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }

    console.log(`Validation result for ${provider}:`, result.valid);

    // If valid, encrypt the key (and secondary key if present)
    if (result.valid) {
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
      if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY not configured');
      }

      const encryptedKey = await encryptApiKey(apiKey, encryptionKey);
      result.encryptedKey = encryptedKey;

      // Encrypt secondary key for registrar providers (password/secret) and
      // Alibaba (optional DashScope workspace id)
      if (secondaryKey && (provider === 'porkbun' || provider === 'alibaba')) {
        result.encryptedSecondaryKey = await encryptApiKey(secondaryKey, encryptionKey);
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Validation error:', error);
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

async function validateOpenRouter(apiKey: string) {
  try {
    // Validate the key by checking auth status via the /auth/key endpoint
    // This is lightweight (no LLM call, no credit spend) and reliably confirms the key is valid
    const authResponse = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.error('OpenRouter auth check failed:', authResponse.status, errorText);
      return { valid: false, error: 'Invalid API key' };
    }

    // Fetch available models
    const modelsResponse = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!modelsResponse.ok) {
      return { valid: false, error: 'Failed to fetch models' };
    }

    const modelsData = await modelsResponse.json();
    return {
      valid: true,
      models: modelsData.data || []
    };
  } catch (error) {
    console.error('OpenRouter validation error:', error);
    return { valid: false, error: 'Connection failed' };
  }
}

async function validateOllama(apiKey: string, dsnUrl?: string) {
  try {
    console.log('Validating Ollama server...');

    const baseUrl = (dsnUrl?.trim() || 'https://ollama.com').replace(/\/+$/, '');
    try {
      new URL(baseUrl);
    } catch {
      return { valid: false, error: 'Server URL must be a valid URL (e.g., https://ollama.example.com)' };
    }
    if (/localhost|127\.0\.0\.1/.test(baseUrl)) {
      return { valid: false, error: 'localhost is not reachable from the cloud. Expose your Ollama server via a public URL (tunnel/VPS), or leave the URL empty to use Ollama Cloud.' };
    }

    // An API key is required for Ollama Cloud, optional for self-hosted
    // ('none' sentinel means no key).
    if (baseUrl === 'https://ollama.com' && apiKey === 'none') {
      return { valid: false, error: 'Ollama Cloud requires an API key (create one at ollama.com/settings/keys), or enter your own server URL.' };
    }

    // Probe /api/tags — confirms the server is reachable, auth works, and
    // returns the installed models.
    const headers: Record<string, string> = {};
    if (apiKey !== 'none') headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid Ollama API key' };
    }
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ollama API error:', response.status, errorText);
      return { valid: false, error: `Ollama server returned ${response.status}. Check the server URL.` };
    }

    const data = await response.json().catch(() => null);
    if (!data || !Array.isArray(data.models)) {
      return { valid: false, error: 'Unexpected response — that URL does not look like an Ollama server' };
    }

    console.log(`Ollama validated successfully, ${data.models.length} models available`);
    return {
      valid: true,
      models: data.models.map((m: { name: string }) => ({ id: `ollama:${m.name}`, name: m.name })),
    };
  } catch (error) {
    console.error('Ollama validation error:', error);
    return { valid: false, error: 'Could not connect to the Ollama server. Check the URL is publicly reachable.' };
  }
}

// dsnUrl doubles as the region/endpoint selector for Alibaba: 'cn' picks the
// mainland DashScope endpoint, a literal http(s) URL is used verbatim (a
// dedicated/workspace deployment, e.g. a private Model Studio host — its
// key won't validate against the shared regional endpoints), anything else
// (including empty) defaults to international. The model list itself is
// static (curated in the frontend, src/hooks/useAlibabaModels.ts) — this is
// an auth-only probe, same pattern as validateOpenAI.
async function validateAlibaba(apiKey: string, dsnUrl?: string) {
  try {
    console.log('Validating Alibaba/DashScope API key...');

    const trimmed = dsnUrl?.trim();
    const baseUrl = trimmed && /^https?:\/\//.test(trimmed)
      ? trimmed.replace(/\/+$/, '')
      : trimmed === 'cn'
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        : 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

    const response = await fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid Alibaba/DashScope API key' };
    }
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Alibaba API error:', response.status, errorText);
      return { valid: false, error: `DashScope returned ${response.status}: ${errorText}` };
    }

    return { valid: true };
  } catch (error) {
    console.error('Alibaba validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateReplicate(apiKey: string) {
  try {
    const response = await fetch('https://api.replicate.com/v1/models', {
      headers: {
        'Authorization': `Token ${apiKey}`,
      },
    });

    if (!response.ok) {
      return { valid: false, error: 'Invalid API key' };
    }

    return { valid: true };
  } catch (error) {
    console.error('Replicate validation error:', error);
    return { valid: false, error: 'Connection failed' };
  }
}

async function validateOpenAI(apiKey: string) {
  try {
    console.log('Testing OpenAI API key...');
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    console.log('OpenAI API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      if (response.status === 401) {
        return { valid: false, error: 'Invalid OpenAI API key' };
      }
      return { valid: false, error: `API returned ${response.status}: ${errorText}` };
    }

    return { valid: true };
  } catch (error) {
    console.error('OpenAI validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateElevenLabs(apiKey: string) {
  try {
    console.log('Testing ElevenLabs API key...');
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    console.log('ElevenLabs API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs API error:', response.status, errorText);
      return { valid: false, error: `API returned ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    console.log('ElevenLabs validation successful, voices count:', data.voices?.length || 0);
    return { valid: true };
  } catch (error) {
    console.error('ElevenLabs validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateApify(apiKey: string) {
  try {
    const response = await fetch('https://api.apify.com/v2/users/me', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 401 || status === 403) {
        return { valid: false, error: 'API key is invalid or expired. Apify keys expire after 90 days.' };
      }
      return { valid: false, error: 'Invalid API key' };
    }

    // Apify keys expire after 90 days - set expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    return { valid: true, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    console.error('Apify validation error:', error);
    return { valid: false, error: 'Connection failed' };
  }
}

async function validateYouTube(apiKey: string) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=${apiKey}`
    );

    if (!response.ok) {
      const errorData = await response.json();
      return { valid: false, error: errorData.error?.message || 'Invalid API key' };
    }

    return { valid: true };
  } catch (error) {
    console.error('YouTube validation error:', error);
    return { valid: false, error: 'Connection failed' };
  }
}

async function validateFal(apiKey: string) {
  try {
    const response = await fetch('https://api.fal.ai/v1/models', {
      headers: {
        'Authorization': `Key ${apiKey}`,
      },
    });

    if (!response.ok) {
      return { valid: false, error: 'Invalid API key' };
    }

    return { valid: true };
  } catch (error) {
    console.error('fal.ai validation error:', error);
    return { valid: false, error: 'Connection failed' };
  }
}

async function validateGHL(apiKey: string) {
  try {
    console.log('Validating LeadConnector token...');

    // Decode JWT to extract location_id and company_id
    const parts = apiKey.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid JWT format' };
    }

    const payload = JSON.parse(atob(parts[1]));
    const locationId = payload.location_id;
    const companyId = payload.company_id;

    if (!locationId) {
      return { valid: false, error: 'No location_id found in token' };
    }

    if (!companyId) {
      return { valid: false, error: 'No company_id found in token' };
    }

    console.log('GHL Token validated - Location ID:', locationId, 'Company ID:', companyId);

    // Return valid - actual API validation will happen when posting content
    return {
      valid: true,
      locationId,
      companyId
    };
  } catch (error) {
    console.error('LeadConnector validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Invalid token format' };
  }
}

async function validateUnipile(apiKey: string, dsnUrl?: string) {
  try {
    console.log('Validating Unipile API key...');

    if (!apiKey || apiKey.length < 10) {
      return { valid: false, error: 'API key is too short' };
    }

    // No endpoint: a Unipile v2 key. v2 has one fixed host and needs only the key. It is stored
    // under provider 'unipile_v2' so the v1 code, which expects one 'unipile' row with a DSN,
    // never picks it up.
    if (!dsnUrl) {
      const v2Response = await fetch('https://api.unipile.com/v2/accounts?limit=1', {
        headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
      });
      if (v2Response.ok) return { valid: true, provider: 'unipile_v2' };
      if (v2Response.status === 401 || v2Response.status === 403) {
        return { valid: false, error: 'Invalid Unipile API key.' };
      }
      return { valid: false, error: `Could not reach Unipile (HTTP ${v2Response.status}). Please try again.` };
    }

    // Validate DSN URL format
    try {
      new URL(dsnUrl);
    } catch {
      return { valid: false, error: 'DSN URL must be a valid URL (e.g., https://api1.unipile.com:13111)' };
    }

    // Validate key + DSN by making a real API call to list accounts
    const { UnipileClient } = await import('npm:unipile-node-sdk@^1.4');
    const client = new UnipileClient(dsnUrl, apiKey);

    try {
      await client.account.getAll();
      console.log('Unipile API key and DSN validated successfully');
      return { valid: true };
    } catch (apiError: unknown) {
      const err = apiError as { body?: { status?: number; message?: string } };
      if (err?.body?.status === 401 || err?.body?.status === 403) {
        return { valid: false, error: 'Invalid API key. Please check your Unipile API key.' };
      }
      // Network/connection errors likely mean bad DSN
      console.error('Unipile validation API error:', apiError);
      return { valid: false, error: 'Could not connect to Unipile. Please check your DSN URL and API key.' };
    }
  } catch (error) {
    console.error('Unipile validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Validation failed' };
  }
}

// ============================================================================
// Contact Enrichment Provider Validators
// ============================================================================

async function validateApollo(apiKey: string) {
  try {
    console.log('Validating Apollo.io API key...');

    // Apollo uses X-Api-Key header
    const response = await fetch('https://api.apollo.io/v1/auth/health', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Apollo API error:', response.status, errorText);
      return { valid: false, error: 'Invalid API key' };
    }

    console.log('Apollo API key validated successfully');
    return { valid: true };
  } catch (error) {
    console.error('Apollo validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateHunter(apiKey: string) {
  try {
    console.log('Validating Hunter API key...');
    const response = await fetch(
      `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(15_000) },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Hunter API error:', response.status, errorText);
      return { valid: false, error: 'Invalid API key' };
    }

    return { valid: true };
  } catch (error) {
    console.error('Hunter validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateProspeo(apiKey: string) {
  try {
    console.log('Validating Prospeo API key...');

    // Prospeo uses X-KEY header and /account-information endpoint
    const response = await fetch('https://api.prospeo.io/account-information', {
      method: 'GET',
      headers: {
        'X-KEY': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Prospeo API error:', response.status, errorText);
      return { valid: false, error: 'Invalid API key' };
    }

    const data = await response.json();

    // Check if the response indicates an error
    if (data.error === true) {
      console.error('Prospeo API returned error:', data.message || 'Unknown error');
      return { valid: false, error: data.message || 'Invalid API key' };
    }

    console.log('Prospeo API key validated, credits:', data.credits || 'unknown');
    return {
      valid: true,
      credits: data.credits,
    };
  } catch (error) {
    console.error('Prospeo validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateZernio(apiKey: string) {
  try {
    // Listing accounts is free and needs only a valid key (sk_ + 64 hex). The count tells the
    // person whether they still have to connect accounts in Zernio.
    const response = await fetch('https://zernio.com/api/v1/accounts?status=connected&excludeHidden=true', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid Zernio API key' };
    }
    if (!response.ok) {
      return { valid: false, error: `Zernio API error: ${response.status}` };
    }
    const data = await response.json().catch(() => ({}));
    const accounts = Array.isArray(data?.accounts) ? data.accounts.length : 0;
    return { valid: true, accounts };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Could not reach Zernio' };
  }
}

async function validateMoltsets(apiKey: string) {
  try {
    console.log('Validating MoltSets API key...');

    // MoltSets has no lightweight /account endpoint that authenticates without
    // a real tool call, so probe with linkedin_to_best_email against a known
    // public profile. A 401/403 means bad auth; a 404 "not_found" still means
    // the key authenticated (and costs 0 tokens per MoltSets' own metadata).
    const response = await fetch('https://api.moltsets.com/api/v1/tools/linkedin_to_best_email', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ linkedin_url: 'https://www.linkedin.com/in/capejames' }),
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid MoltSets API key' };
    }
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      console.error('MoltSets API error:', response.status, errorText);
      return { valid: false, error: `API returned ${response.status}` };
    }

    console.log('MoltSets API key validated successfully');
    return { valid: true };
  } catch (error) {
    console.error('MoltSets validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validateQuickenrich(apiKey: string) {
  try {
    console.log('Validating QuickEnrich API key...');

    // QuickEnrich has no dedicated health endpoint, so probe the reverse email
    // lookup. Auth is checked BEFORE parameter validation (verified live: a bad
    // key returns 401 even with a malformed email), so the ONLY thing that means
    // "bad key" is 401/403. Everything else — 200 (hit/miss), 404, 422 (our
    // probe address rejected), 429 — means the key authenticated. Use a
    // well-formed, non-reserved domain so a valid key gets a clean 200 miss and
    // spends 0 credits.
    const response = await fetch('https://app.quickenrich.io/api/employees/email-search?email=probe.verify@verify-aca-integration-8a2f.com', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid QuickEnrich API key' };
    }

    console.log('QuickEnrich API key validated successfully (HTTP ' + response.status + ')');
    return { valid: true };
  } catch (error) {
    console.error('QuickEnrich validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

// ============================================================================
// Email Infrastructure Provider Validators
// ============================================================================

async function validateZapMail(apiKey: string) {
  try {
    console.log('Validating ZapMail API key...');

    const response = await fetch('https://api.zapmail.ai/api/v2/mailboxes/list?page=1&limit=1', {
      headers: {
        'x-auth-zapmail': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ZapMail API error:', response.status, errorText);
      return { valid: false, error: 'Invalid ZapMail API key' };
    }

    console.log('ZapMail API key validated successfully');
    return { valid: true };
  } catch (error) {
    console.error('ZapMail validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

// ============================================================================
// Email Verification Provider Validators
// ============================================================================

async function validateMailtesterNinja(apiKey: string) {
  try {
    console.log('Validating Mailtester Ninja API key...');

    // Mailtester Ninja has no /me / quota endpoint. Probe the verification
    // endpoint with a sentinel address. Any 200 response with a `code` field
    // means the key was accepted — even `code: 'ko'` for an invalid mailbox.
    // Auth failures return 401/403.
    const probeEmail = 'noreply@example.com';
    const url = `https://happy.mailtester.ninja/ninja?email=${encodeURIComponent(probeEmail)}&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid Mailtester Ninja API key' };
    }
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Mailtester Ninja API error:', response.status, errorText);
      return { valid: false, error: `API returned ${response.status}` };
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data.code !== 'string') {
      return { valid: false, error: 'Unexpected response from Mailtester Ninja — key may be invalid' };
    }

    console.log('Mailtester Ninja API key validated successfully (probe code:', data.code, ')');
    return { valid: true };
  } catch (error) {
    console.error('Mailtester Ninja validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

// ============================================================================
// UGC Video Provider Validators
// ============================================================================

async function validateHeyGen(apiKey: string) {
  try {
    console.log('Validating HeyGen API key...');

    // Test key by listing avatars
    const response = await fetch('https://api.heygen.com/v2/avatars', {
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('HeyGen API error:', response.status, errorText);
      return { valid: false, error: 'Invalid HeyGen API key' };
    }

    console.log('HeyGen API key validated successfully');

    // Auto-register webhook endpoint
    let webhookRegistered = false;
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      if (supabaseUrl) {
        const webhookUrl = `${supabaseUrl}/functions/v1/heygen-webhook`;
        const webhookEvents = [
          'avatar_video.success',
          'avatar_video.fail',
          'photo_avatar_train.success',
          'photo_avatar_train.fail',
        ];

        const webhookResponse = await fetch('https://api.heygen.com/v1/webhook/endpoint.add', {
          method: 'POST',
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: webhookUrl, events: webhookEvents }),
        });

        if (webhookResponse.ok) {
          const webhookData = await webhookResponse.json();
          webhookRegistered = true;
          console.log('HeyGen webhook registered:', webhookData.data?.endpoint_id);

          // Store webhook endpoint details for signature verification
          // This will be saved by the frontend after key validation
          return {
            valid: true,
            webhookRegistered: true,
            webhookEndpointId: webhookData.data?.endpoint_id,
            webhookSecret: webhookData.data?.secret,
          };
        } else {
          console.warn('Failed to register HeyGen webhook:', await webhookResponse.text());
        }
      }
    } catch (webhookError) {
      console.warn('Webhook registration failed (non-blocking):', webhookError);
    }

    return { valid: true, webhookRegistered };
  } catch (error) {
    console.error('HeyGen validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

// ============================================================================
// Stock Footage Provider Validators
// ============================================================================

async function validatePexels(apiKey: string) {
  try {
    console.log('Validating Pexels API key...');

    const response = await fetch('https://api.pexels.com/videos/search?query=test&per_page=1', {
      headers: { Authorization: apiKey },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pexels API error:', response.status, errorText);
      return { valid: false, error: 'Invalid Pexels API key' };
    }

    console.log('Pexels API key validated successfully');
    return { valid: true };
  } catch (error) {
    console.error('Pexels validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

async function validatePixabay(apiKey: string) {
  try {
    console.log('Validating Pixabay API key...');
    const response = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=test&per_page=3`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pixabay API error:', response.status, errorText);
      return { valid: false, error: 'Invalid Pixabay API key' };
    }
    return { valid: true };
  } catch (error) {
    console.error('Pixabay validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

// ============================================================================
// Domain Registrar Validators
// ============================================================================

async function validatePorkbun(apiKey: string, secretKey?: string) {
  try {
    console.log('Validating Porkbun credentials...');

    if (!secretKey) {
      return { valid: false, error: 'Secret API Key is required for Porkbun' };
    }

    const response = await fetch('https://api.porkbun.com/api/json/v3/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: apiKey, secretapikey: secretKey }),
    });

    if (!response.ok) {
      return { valid: false, error: `API returned ${response.status}` };
    }

    const data = await response.json();

    if (data.status !== 'SUCCESS') {
      return { valid: false, error: data.message || 'Invalid credentials' };
    }

    console.log('Porkbun validated successfully. IP:', data.yourIp);
    return { valid: true };
  } catch (error) {
    console.error('Porkbun validation error:', error);
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}
