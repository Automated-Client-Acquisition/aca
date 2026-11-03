import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

interface WordPressTerm {
  id: number;
  name: string;
  slug: string;
  count: number;
  parent?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

  if (!encryptionKey) {
    return new Response(JSON.stringify({ error: 'ENCRYPTION_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { site_id } = await req.json();

    if (!site_id) {
      return new Response(JSON.stringify({ error: 'site_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch WordPress site credentials
    const { data: site, error: siteError } = await supabase
      .from('wordpress_sites')
      .select('*')
      .eq('id', site_id)
      .single();

    if (siteError || !site) {
      return new Response(JSON.stringify({ error: 'WordPress site not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, site.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    if (!site.is_valid) {
      return new Response(JSON.stringify({
        error: 'WordPress site connection is invalid. Please reconnect in Settings.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Decrypt password
    const appPassword = await decryptCredentials(site.app_password_encrypted, encryptionKey);

    // Create Basic Auth header
    const normalizedPassword = appPassword.replace(/\s+/g, '');
    const authString = `${site.username}:${normalizedPassword}`;
    const encoder = new TextEncoder();
    const authBytes = encoder.encode(authString);
    const base64Auth = btoa(String.fromCharCode(...authBytes));

    // Fetch categories and tags in parallel
    const [categoriesResponse, tagsResponse] = await Promise.all([
      fetch(`${site.api_url}/categories?per_page=100&orderby=count&order=desc`, {
        headers: { 'Authorization': `Basic ${base64Auth}` },
      }),
      fetch(`${site.api_url}/tags?per_page=100&orderby=count&order=desc`, {
        headers: { 'Authorization': `Basic ${base64Auth}` },
      }),
    ]);

    let categories: WordPressTerm[] = [];
    let tags: WordPressTerm[] = [];

    if (categoriesResponse.ok) {
      const rawCategories = await categoriesResponse.json();
      categories = rawCategories.map((c: any) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        count: c.count,
        parent: c.parent || undefined,
      }));
    } else {
      console.error('Failed to fetch categories:', categoriesResponse.status);
    }

    if (tagsResponse.ok) {
      const rawTags = await tagsResponse.json();
      tags = rawTags.map((t: any) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        count: t.count,
      }));
    } else {
      console.error('Failed to fetch tags:', tagsResponse.status);
    }

    return new Response(JSON.stringify({
      categories,
      tags,
      site_name: site.name,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Fetch WordPress taxonomies error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to fetch taxonomies'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
