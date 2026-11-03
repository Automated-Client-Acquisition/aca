/**
 * Preview Page — Public Edge Function
 *
 * Serves self-hosted preview documents as branded HTML pages.
 * No authentication required (public-facing).
 *
 * GET /preview-page?id={uuid}
 *   → Fetches preview_documents + organization_branding
 *   → Renders as white-labeled HTML via html-document-renderer
 *   → Caches for 1 hour (public, revalidatable)
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { renderDocument } from '../_shared/html-document-renderer.ts';
import type { PageBranding } from '../_shared/html-document-renderer.ts';
import type { NotionDocumentDef } from '../_shared/notion-block-types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlError(title: string, message: string, status: number): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0; min-height: 100vh;
      display: grid; place-items: center;
      background: #f8f9fa; color: #1a1a1a;
    }
    .card {
      max-width: 480px; padding: 40px;
      text-align: center;
    }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    p { color: #666; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`,
    {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return htmlError('Method Not Allowed', 'Only GET requests are supported.', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return htmlError('Server Error', 'Missing server configuration.', 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const url = new URL(req.url);
    const docId = url.searchParams.get('id');

    if (!docId) {
      return htmlError('Missing Document ID', 'Please provide a valid document link.', 400);
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(docId)) {
      return htmlError('Invalid Link', 'This document link is not valid.', 400);
    }

    // Fetch the preview document
    const { data: doc, error: docError } = await supabase
      .from('preview_documents')
      .select('id, organization_id, title, icon, document_json')
      .eq('id', docId)
      .single();

    if (docError || !doc) {
      return htmlError('Document Not Found', 'This document may have been removed or the link is incorrect.', 404);
    }

    // Fetch organization branding
    const { data: branding } = await supabase
      .from('organization_branding')
      .select('logo_url, logo_dark_url, primary_color, cta_color, accent_color, app_name, footer_text, support_email, favicon_url, og_image_url, meta_title, meta_description, hide_powered_by, custom_css')
      .eq('organization_id', doc.organization_id)
      .maybeSingle();

    // Build the branding config
    const pageBranding: PageBranding | null = branding ? {
      logo_url: branding.logo_url,
      logo_dark_url: branding.logo_dark_url,
      primary_color: branding.primary_color as PageBranding['primary_color'],
      cta_color: branding.cta_color as PageBranding['cta_color'],
      accent_color: branding.accent_color as PageBranding['accent_color'],
      app_name: branding.app_name,
      footer_text: branding.footer_text,
      support_email: branding.support_email,
      favicon_url: branding.favicon_url,
      og_image_url: branding.og_image_url,
      meta_title: branding.meta_title,
      meta_description: branding.meta_description,
      hide_powered_by: branding.hide_powered_by,
      custom_css: branding.custom_css,
    } : null;

    // Parse the stored document JSON
    const documentDef: NotionDocumentDef = {
      title: doc.title,
      icon: doc.icon || undefined,
      blocks: (doc.document_json as { blocks?: unknown[] })?.blocks || doc.document_json as unknown[],
    };

    // If document_json has a top-level blocks array, use it directly
    // Otherwise treat the whole object as a NotionDocumentDef
    if (doc.document_json && typeof doc.document_json === 'object' && 'blocks' in doc.document_json) {
      const stored = doc.document_json as { title?: string; icon?: string; blocks: unknown[] };
      documentDef.title = stored.title || doc.title;
      documentDef.icon = stored.icon || doc.icon || undefined;
      documentDef.blocks = stored.blocks as NotionDocumentDef['blocks'];
    }

    // Build the current page URL for OG tags
    const pageUrl = `${url.origin}${url.pathname}?id=${docId}`;

    // Render the HTML
    const html = renderDocument(documentDef, {
      branding: pageBranding,
      showPdfButton: true,
      pageUrl,
    });

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('[preview-page] Error:', error);
    return htmlError(
      'Something Went Wrong',
      'We encountered an error loading this document. Please try again later.',
      500,
    );
  }
});
