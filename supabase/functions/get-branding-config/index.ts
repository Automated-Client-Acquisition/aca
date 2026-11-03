import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Default ACA branding configuration
const DEFAULT_BRANDING = {
  app_name: 'ACA',
  tagline: 'Automated Client Acquisition',
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  og_image_url: null,
  primary_color: { h: 1, s: 70, l: 54 },
  cta_color: { h: 43, s: 80, l: 72 },
  accent_color: { h: 40, s: 15, l: 94 },
  meta_title: null,
  meta_description: null,
  twitter_handle: '@ACAXtreme',
  support_email: null,
  support_url: null,
  footer_text: null,
  terms_url: null,
  privacy_url: null,
  hide_powered_by: false,
  custom_css: null,
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // Get domain from headers or query param (for testing)
    const domain = url.searchParams.get('domain') ||
                   req.headers.get('x-forwarded-host') ||
                   req.headers.get('host') ||
                   url.hostname;

    // Strip port for local development
    const cleanDomain = domain.split(':')[0].toLowerCase();

    console.log(`Resolving branding for domain: ${cleanDomain}`);

    // Skip domain lookup for localhost and Vercel preview deployments
    const skipDomains = ['localhost', '127.0.0.1', 'vercel.app'];
    const shouldSkipLookup = skipDomains.some(skip => cleanDomain.includes(skip));

    if (shouldSkipLookup) {
      console.log('Skipping domain lookup for development/preview domain');
      return new Response(JSON.stringify({
        branding: DEFAULT_BRANDING,
        organization_id: null,
        organization_slug: null,
        is_white_labeled: false,
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // Create Supabase client with service role for public domain lookup
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Use the helper function to get branding by domain
    const { data: brandingData, error } = await supabase
      .rpc('get_branding_by_domain', { p_domain: cleanDomain });

    if (error) {
      console.error('Error fetching branding:', error);
      // Return default branding on error
      return new Response(JSON.stringify({
        branding: DEFAULT_BRANDING,
        organization_id: null,
        organization_slug: null,
        is_white_labeled: false,
        error: 'Failed to fetch branding',
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // If no branding found for this domain, return defaults
    if (!brandingData || brandingData.length === 0) {
      console.log(`No branding found for domain: ${cleanDomain}`);
      return new Response(JSON.stringify({
        branding: DEFAULT_BRANDING,
        organization_id: null,
        organization_slug: null,
        is_white_labeled: false,
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      });
    }

    const row = brandingData[0];
    console.log(`Found branding for org: ${row.organization_slug}`);

    // Construct branding response, merging with defaults
    const branding = {
      app_name: row.app_name || DEFAULT_BRANDING.app_name,
      tagline: row.tagline || DEFAULT_BRANDING.tagline,
      logo_url: row.logo_url,
      logo_dark_url: row.logo_dark_url,
      favicon_url: row.favicon_url,
      og_image_url: row.og_image_url,
      primary_color: row.primary_color || DEFAULT_BRANDING.primary_color,
      cta_color: row.cta_color || DEFAULT_BRANDING.cta_color,
      accent_color: row.accent_color || DEFAULT_BRANDING.accent_color,
      meta_title: row.meta_title,
      meta_description: row.meta_description,
      twitter_handle: row.twitter_handle || DEFAULT_BRANDING.twitter_handle,
      support_email: row.support_email,
      support_url: row.support_url,
      footer_text: row.footer_text,
      terms_url: row.terms_url,
      privacy_url: row.privacy_url,
      hide_powered_by: row.hide_powered_by || false,
      custom_css: row.custom_css,
    };

    return new Response(JSON.stringify({
      branding,
      organization_id: row.organization_id,
      organization_slug: row.organization_slug,
      is_white_labeled: true,
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        // Cache for 5 minutes, allow stale for 10 minutes
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });

  } catch (error) {
    console.error('Error in get-branding-config:', error);

    return new Response(JSON.stringify({
      branding: DEFAULT_BRANDING,
      organization_id: null,
      organization_slug: null,
      is_white_labeled: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }
});
