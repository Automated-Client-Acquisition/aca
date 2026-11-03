import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
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

  // Combine ciphertext and auth tag
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

serve(async (req) => {
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
      site_id,
      name,
      site_url,
      api_url,
      username,
      app_password,
      default_status,
      test_only
    } = body;

    // Test only mode - fetch existing credentials and test
    if (test_only && site_id) {
      const { data: site, error: fetchError } = await supabase
        .from('wordpress_sites')
        .select('*')
        .eq('id', site_id)
        .single();

      if (fetchError || !site) {
        return new Response(JSON.stringify({ success: false, error: 'Site not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // The service-role client acts on whatever row the body names, so the caller
      // must be able to access that row's org (a valid anon-key JWT alone is not enough).
      try { await assertOrgAccess(req, supabase, site.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

      // Decrypt password
      const decryptedPassword = await decryptCredentials(site.app_password_encrypted, encryptionKey);

      // Test connection (pass site_url for REST API discovery if needed)
      const testResult = await testWordPressConnection(site.api_url, site.username, decryptedPassword, site.site_url);

      // Update site status (and API URL if a different one was discovered)
      const updateData: Record<string, unknown> = {
        is_valid: testResult.success,
        last_tested_at: new Date().toISOString(),
        error_message: testResult.success ? null : testResult.error,
      };

      // If we discovered a working API URL that's different, update it
      if (testResult.success && testResult.discovered_api_url) {
        updateData.api_url = testResult.discovered_api_url;
        console.log('Updating API URL to discovered URL:', testResult.discovered_api_url);
      }

      await supabase
        .from('wordpress_sites')
        .update(updateData)
        .eq('id', site_id);

      return new Response(JSON.stringify(testResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate required fields
    if (!organization_id || !name || !site_url || !username) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: organization_id, name, site_url, username'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For new sites or password updates, app_password is required
    if (!site_id && !app_password) {
      return new Response(JSON.stringify({ success: false, error: 'Application password is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let storedPasswordEncrypted: string | null = null;

    if (site_id) {
      const { data: storedSite } = await supabase
        .from('wordpress_sites')
        .select('organization_id, site_url, api_url, app_password_encrypted')
        .eq('id', site_id)
        .maybeSingle();

      if (!storedSite) {
        return new Response(JSON.stringify({ success: false, error: 'Site not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // The service-role client acts on whatever row the body names, so the caller
      // must be able to access that row's org (a valid anon-key JWT alone is not enough).
      try { await assertOrgAccess(req, supabase, storedSite.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

      // An update never moves the site to another organization.
      if (storedSite.organization_id !== organization_id) {
        return new Response(JSON.stringify({ success: false, error: 'organization_id does not match the site' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Without a new password the stored one is reused, so it may only be sent to the
      // stored site: its api_url, or the default REST path the app derives from its site_url.
      if (!app_password) {
        const stripSlash = (u: unknown) => String(u ?? '').replace(/\/+$/, '');
        const storedSiteUrl = stripSlash(storedSite.site_url);
        const apiUrlIsStored = stripSlash(api_url) === stripSlash(storedSite.api_url)
          || stripSlash(api_url) === `${storedSiteUrl}/wp-json/wp/v2`;
        if (stripSlash(site_url) !== storedSiteUrl || !apiUrlIsStored) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Re-enter the application password to change the site URL',
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      storedPasswordEncrypted = storedSite.app_password_encrypted;
    } else {
      // A new site is saved under the body's organization_id, so the caller must be able to access it.
      try { await assertOrgAccess(req, supabase, organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }
    }

    // Get the password to test with
    let passwordToTest = app_password;
    let encryptedPassword: string | undefined;

    if (app_password) {
      // Encrypt the new password
      encryptedPassword = await encryptCredentials(app_password, encryptionKey);
      passwordToTest = app_password;
    } else if (storedPasswordEncrypted) {
      // Reuse the stored password (only for the stored site, checked above)
      passwordToTest = await decryptCredentials(storedPasswordEncrypted, encryptionKey);
    }

    // Test connection (pass site_url for REST API discovery if needed)
    const testResult = await testWordPressConnection(api_url, username, passwordToTest, site_url);

    if (!testResult.success) {
      return new Response(JSON.stringify(testResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use discovered API URL if one was found, otherwise use the provided one
    const effectiveApiUrl = testResult.discovered_api_url || api_url;
    if (testResult.discovered_api_url) {
      console.log('Using discovered API URL:', testResult.discovered_api_url);
    }

    // Save or update the site
    const siteData: any = {
      organization_id,
      name,
      site_url,
      api_url: effectiveApiUrl,
      username,
      default_status: default_status || 'draft',
      is_valid: true,
      last_tested_at: new Date().toISOString(),
      error_message: null,
    };

    if (encryptedPassword) {
      siteData.app_password_encrypted = encryptedPassword;
    }

    if (site_id) {
      // Update existing
      const { error: updateError } = await supabase
        .from('wordpress_sites')
        .update(siteData)
        .eq('id', site_id);

      if (updateError) {
        throw updateError;
      }
    } else {
      // Insert new
      const { error: insertError } = await supabase
        .from('wordpress_sites')
        .insert(siteData);

      if (insertError) {
        throw insertError;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: site_id ? 'WordPress site updated' : 'WordPress site added',
      site_info: testResult.site_info,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('WordPress validation error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Discover the REST API URL from the site root
async function discoverRestApiUrl(siteUrl: string): Promise<{ apiUrl: string | null; error?: string }> {
  try {
    console.log('Discovering REST API URL for:', siteUrl);

    // First, try to get the REST API URL from the site's Link header
    const response = await fetch(siteUrl, {
      method: 'HEAD',
      redirect: 'follow',
    });

    // Check for the REST API discovery link in headers
    const linkHeader = response.headers.get('Link');
    if (linkHeader) {
      // Parse Link header to find the REST API URL
      // Format: <https://example.com/wp-json/>; rel="https://api.w.org/"
      const apiLinkMatch = linkHeader.match(/<([^>]+)>;\s*rel=["']?https:\/\/api\.w\.org\/?["']?/i);
      if (apiLinkMatch && apiLinkMatch[1]) {
        let discoveredUrl = apiLinkMatch[1];
        // Ensure it ends with /wp/v2 for the posts endpoint
        if (discoveredUrl.endsWith('/')) {
          discoveredUrl = discoveredUrl.slice(0, -1);
        }
        if (!discoveredUrl.endsWith('/wp/v2')) {
          discoveredUrl = `${discoveredUrl}/wp/v2`;
        }
        console.log('Discovered REST API URL from Link header:', discoveredUrl);
        return { apiUrl: discoveredUrl };
      }
    }

    // Fallback: Try to fetch /wp-json to check if REST API exists
    const wpJsonUrl = `${siteUrl}/wp-json`;
    const wpJsonResponse = await fetch(wpJsonUrl, {
      redirect: 'follow',
    });

    if (wpJsonResponse.ok) {
      console.log('Found REST API at standard location:', `${siteUrl}/wp-json/wp/v2`);
      return { apiUrl: `${siteUrl}/wp-json/wp/v2` };
    }

    // Check if it's a 404 specifically - provide detailed troubleshooting
    if (wpJsonResponse.status === 404) {
      return {
        apiUrl: null,
        error: 'WordPress REST API not found. This usually means: 1) Pretty permalinks are not enabled - go to WordPress Admin → Settings → Permalinks and select any option other than "Plain", then save. 2) A security plugin is blocking REST API access. 3) Your server/host is blocking /wp-json requests. Try visiting your-site.com/wp-json in a browser to check.'
      };
    }

    return {
      apiUrl: null,
      error: `Could not access WordPress REST API (HTTP ${wpJsonResponse.status}). The REST API may be blocked by a security plugin or firewall.`
    };
  } catch (err) {
    console.error('REST API discovery failed:', err);
    return {
      apiUrl: null,
      error: 'Could not connect to WordPress site. Please verify the URL is correct and the site is accessible.'
    };
  }
}

async function testWordPressConnection(
  apiUrl: string,
  username: string,
  appPassword: string,
  siteUrl?: string
): Promise<{ success: boolean; error?: string; site_info?: any; discovered_api_url?: string }> {
  try {
    // Application passwords can be used with or without spaces - WordPress accepts both
    // But we'll normalize by removing spaces just in case
    const normalizedPassword = appPassword.replace(/\s+/g, '');

    // Create Basic Auth header - use TextEncoder for proper UTF-8 handling
    const authString = `${username}:${normalizedPassword}`;
    const encoder = new TextEncoder();
    const authBytes = encoder.encode(authString);
    const base64Auth = btoa(String.fromCharCode(...authBytes));

    console.log('Testing WordPress connection to:', apiUrl);
    console.log('Using username:', username);
    console.log('Password length (without spaces):', normalizedPassword.length);

    // First, test if the REST API is even accessible (unauthenticated)
    let effectiveApiUrl = apiUrl;
    try {
      const rootResponse = await fetch(apiUrl, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!rootResponse.ok) {
        console.error('REST API root not accessible:', rootResponse.status, 'at', apiUrl);

        // If we have the site URL and got a 404, try to discover the correct REST API URL
        if (siteUrl && rootResponse.status === 404) {
          console.log('Got 404, attempting REST API discovery from site root...');
          const discovery = await discoverRestApiUrl(siteUrl);
          if (discovery.apiUrl && discovery.apiUrl !== apiUrl) {
            console.log('Discovered alternative API URL:', discovery.apiUrl);
            effectiveApiUrl = discovery.apiUrl;
            // Verify the discovered URL works
            const verifyResponse = await fetch(effectiveApiUrl, {
              headers: { 'Content-Type': 'application/json' },
            });
            if (!verifyResponse.ok) {
              return {
                success: false,
                error: discovery.error || `WordPress REST API is not accessible (HTTP ${verifyResponse.status}). Make sure the REST API is enabled and not blocked by a security plugin.`
              };
            }
          } else {
            return {
              success: false,
              error: discovery.error || `WordPress REST API is not accessible (HTTP ${rootResponse.status}). Make sure the REST API is enabled and not blocked by a security plugin.`
            };
          }
        } else {
          return {
            success: false,
            error: `WordPress REST API is not accessible (HTTP ${rootResponse.status}). Make sure the REST API is enabled and not blocked by a security plugin.`
          };
        }
      }
    } catch (rootErr) {
      console.error('Failed to reach REST API root:', rootErr);

      // Try discovery if we have site URL
      if (siteUrl) {
        console.log('Connection failed, attempting REST API discovery...');
        const discovery = await discoverRestApiUrl(siteUrl);
        if (discovery.apiUrl) {
          effectiveApiUrl = discovery.apiUrl;
          // Verify the discovered URL works
          try {
            const verifyResponse = await fetch(effectiveApiUrl, {
              headers: { 'Content-Type': 'application/json' },
            });
            if (!verifyResponse.ok) {
              return {
                success: false,
                error: discovery.error || 'Could not reach the WordPress REST API. Please check the site URL is correct and the site is online.'
              };
            }
          } catch {
            return {
              success: false,
              error: 'Could not reach the WordPress REST API. Please check the site URL is correct and the site is online.'
            };
          }
        } else {
          return {
            success: false,
            error: discovery.error || 'Could not reach the WordPress REST API. Please check the site URL is correct and the site is online.'
          };
        }
      } else {
        return {
          success: false,
          error: 'Could not reach the WordPress REST API. Please check the site URL is correct and the site is online.'
        };
      }
    }

    // Test by fetching user info (requires authentication)
    const response = await fetch(`${effectiveApiUrl}/users/me?context=edit`, {
      headers: {
        'Authorization': `Basic ${base64Auth}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('WordPress API error:', response.status, errorText);
      console.error('API URL used:', `${effectiveApiUrl}/users/me?context=edit`);
      console.error('Username used:', username);

      if (response.status === 401) {
        // Try to parse error for more details
        let errorDetails = '';
        let specificHelp = '';
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.code === 'invalid_username') {
            errorDetails = ' The username was not found.';
            specificHelp = ' Try using your WordPress username instead of email.';
          } else if (errorJson.code === 'incorrect_password') {
            errorDetails = ' The application password is incorrect.';
            specificHelp = ' Generate a new Application Password from WordPress Admin → Users → Profile.';
          } else if (errorJson.code === 'rest_not_logged_in' || (errorJson.message && errorJson.message.includes('not currently logged in'))) {
            // This specific error means Application Passwords are likely disabled
            return {
              success: false,
              error: 'Application Passwords appear to be disabled on your WordPress site. This can happen if: 1) A security plugin (Wordfence, Sucuri, etc.) is blocking REST API authentication, 2) Your site requires HTTPS for Application Passwords but uses HTTP, 3) The feature was manually disabled. Check your security plugin settings or contact your hosting provider.'
            };
          } else if (errorJson.message) {
            errorDetails = ` WordPress says: ${errorJson.message}`;
          }
        } catch {
          // Not JSON, use raw text if short
          if (errorText.length < 100) {
            errorDetails = ` Server response: ${errorText}`;
          }
        }

        return {
          success: false,
          error: `Authentication failed.${errorDetails}${specificHelp} Please verify: 1) Username or email is correct, 2) Application Password is correct (from WordPress Admin → Users → Profile → Application Passwords), 3) Application Passwords are enabled on your WordPress site.`
        };
      }
      if (response.status === 403) {
        return { success: false, error: 'Insufficient permissions. Make sure the user can create posts.' };
      }
      if (response.status === 404) {
        return { success: false, error: 'WordPress REST API not found. Is the REST API enabled?' };
      }

      return { success: false, error: `WordPress API error: ${response.status}` };
    }

    const userData = await response.json();

    // Check if user can create posts
    const capabilities = userData.capabilities || {};
    if (!capabilities.edit_posts && !capabilities.publish_posts) {
      return {
        success: false,
        error: 'User does not have permission to create posts. Please use an Editor or Administrator account.'
      };
    }

    return {
      success: true,
      site_info: {
        user_id: userData.id,
        user_name: userData.name,
        user_email: userData.email,
        can_publish: capabilities.publish_posts || false,
      },
      // Return the discovered API URL if it differs from the original
      discovered_api_url: effectiveApiUrl !== apiUrl ? effectiveApiUrl : undefined,
    };
  } catch (error) {
    console.error('Connection test error:', error);

    if (error instanceof TypeError && error.message.includes('fetch')) {
      return { success: false, error: 'Could not connect to WordPress site. Check the URL and try again.' };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed'
    };
  }
}
