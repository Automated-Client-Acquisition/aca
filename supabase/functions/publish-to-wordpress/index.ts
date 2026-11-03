import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { requireFeature } from "../_shared/featureAccess.ts";
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

// Convert content to HTML for WordPress
// If content already has HTML tags, preserve them; otherwise convert markdown
function convertToWordPressHTML(content: string): string {
  // Check if content already has significant HTML structure
  const hasHtmlStructure = /<(h[1-6]|p|div|ul|ol|blockquote|article|section)[^>]*>/i.test(content);

  if (hasHtmlStructure) {
    // Content is already HTML - just clean it up slightly
    return content
      // Ensure proper WordPress block structure for Gutenberg
      .replace(/<h2>/g, '<!-- wp:heading -->\n<h2>')
      .replace(/<\/h2>/g, '</h2>\n<!-- /wp:heading -->')
      .replace(/<h3>/g, '<!-- wp:heading {"level":3} -->\n<h3>')
      .replace(/<\/h3>/g, '</h3>\n<!-- /wp:heading -->')
      .replace(/<p>/g, '<!-- wp:paragraph -->\n<p>')
      .replace(/<\/p>/g, '</p>\n<!-- /wp:paragraph -->')
      .replace(/<ul>/g, '<!-- wp:list -->\n<ul>')
      .replace(/<\/ul>/g, '</ul>\n<!-- /wp:list -->')
      .replace(/<ol>/g, '<!-- wp:list {"ordered":true} -->\n<ol>')
      .replace(/<\/ol>/g, '</ol>\n<!-- /wp:list -->')
      .replace(/<blockquote>/g, '<!-- wp:quote -->\n<blockquote>')
      .replace(/<\/blockquote>/g, '</blockquote>\n<!-- /wp:quote -->');
  }

  // Content is markdown - convert to HTML
  return content
    .replace(/^### (.*$)/gim, '<!-- wp:heading {"level":3} -->\n<h3>$1</h3>\n<!-- /wp:heading -->')
    .replace(/^## (.*$)/gim, '<!-- wp:heading -->\n<h2>$1</h2>\n<!-- /wp:heading -->')
    .replace(/^# (.*$)/gim, '<!-- wp:heading {"level":1} -->\n<h1>$1</h1>\n<!-- /wp:heading -->')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)+/g, '<!-- wp:list -->\n<ul>$&</ul>\n<!-- /wp:list -->')
    .replace(/\n\n/g, '\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n')
    .replace(/^(?!<|<!--)(.+)$/gm, '<!-- wp:paragraph -->\n<p>$1</p>\n<!-- /wp:paragraph -->');
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
    const { output_id, site_id, article } = body;

    if (!site_id || !article) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: site_id, article'
      }), {
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
      return new Response(JSON.stringify({ success: false, error: 'WordPress site not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, site.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    // output_id is written back below with the service-role client, so it must
    // belong to the same org as the site.
    if (output_id) {
      const { data: output } = await supabase
        .from('content_outputs')
        .select('organization_id')
        .eq('id', output_id)
        .maybeSingle();
      if (!output || output.organization_id !== site.organization_id) {
        return unauthorized({ status: 403, message: 'This output does not belong to the site\'s organization' }, corsHeaders);
      }
    }

    if (!site.is_valid) {
      return new Response(JSON.stringify({
        success: false,
        error: 'WordPress site connection is invalid. Please reconnect in Settings.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate feature access - Publishing requires Pro plan
    await requireFeature(supabase, site.organization_id, "publishing");

    // Decrypt password
    const appPassword = await decryptCredentials(site.app_password_encrypted, encryptionKey);

    // Normalize password (remove spaces) and create Basic Auth header with proper UTF-8 encoding
    const normalizedPassword = appPassword.replace(/\s+/g, '');
    const authString = `${site.username}:${normalizedPassword}`;
    const encoder = new TextEncoder();
    const authBytes = encoder.encode(authString);
    const base64Auth = btoa(String.fromCharCode(...authBytes));

    // Prepare WordPress post data
    const wpPost: any = {
      title: article.title,
      content: convertToWordPressHTML(article.content),
      status: article.status || 'draft',
    };

    // Add optional fields
    if (article.excerpt) {
      wpPost.excerpt = article.excerpt;
    }

    if (article.slug) {
      wpPost.slug = article.slug;
    }

    // Handle scheduled posts
    if (article.scheduled_at) {
      wpPost.status = 'future';
      wpPost.date = article.scheduled_at;
    }

    // Handle featured image if provided
    let featuredMediaId: number | null = null;
    if (article.featured_image_url) {
      try {
        featuredMediaId = await uploadFeaturedImage(
          site.api_url,
          base64Auth,
          article.featured_image_url,
          article.featured_image_alt || article.title
        );
        if (featuredMediaId) {
          wpPost.featured_media = featuredMediaId;
        }
      } catch (imgError) {
        console.error('Failed to upload featured image:', imgError);
        // Continue without featured image
      }
    }

    // Handle categories
    if (article.categories && article.categories.length > 0) {
      const categoryIds = await getOrCreateTerms(site.api_url, base64Auth, 'categories', article.categories);
      if (categoryIds.length > 0) {
        wpPost.categories = categoryIds;
      }
    }

    // Handle tags
    if (article.tags && article.tags.length > 0) {
      const tagIds = await getOrCreateTerms(site.api_url, base64Auth, 'tags', article.tags);
      if (tagIds.length > 0) {
        wpPost.tags = tagIds;
      }
    }

    // Create the post
    const createResponse = await fetch(`${site.api_url}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${base64Auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(wpPost),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('WordPress create post error:', createResponse.status, errorText);
      return new Response(JSON.stringify({
        success: false,
        error: `Failed to create post: ${createResponse.status}`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const createdPost = await createResponse.json();

    // Update Yoast SEO meta if available (requires Yoast REST API)
    if (article.meta_description || article.focus_keyword) {
      try {
        await updateYoastMeta(
          site.api_url,
          base64Auth,
          createdPost.id,
          article.meta_description,
          article.focus_keyword
        );
      } catch (yoastError) {
        console.log('Yoast SEO update skipped (plugin may not be installed):', yoastError);
      }
    }

    // Update content_outputs with publish info if output_id provided
    if (output_id) {
      // First fetch the current data, then merge with new fields
      const { data: currentOutput } = await supabase
        .from('content_outputs')
        .select('data')
        .eq('id', output_id)
        .single();

      const updatedData = {
        ...(currentOutput?.data || {}),
        wordpress_post_id: createdPost.id,
        wordpress_post_url: createdPost.link,
        wordpress_site_id: site_id,
        published_at: new Date().toISOString(),
      };

      await supabase
        .from('content_outputs')
        .update({ data: updatedData })
        .eq('id', output_id);
    }

    return new Response(JSON.stringify({
      success: true,
      post_id: createdPost.id,
      post_url: createdPost.link,
      edit_url: `${site.site_url}/wp-admin/post.php?post=${createdPost.id}&action=edit`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Publish to WordPress error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Publishing failed'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Upload featured image to WordPress media library
async function uploadFeaturedImage(
  apiUrl: string,
  auth: string,
  imageUrl: string,
  altText: string
): Promise<number | null> {
  try {
    // Fetch the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }

    const imageBlob = await imageResponse.blob();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const filename = `featured-image-${Date.now()}.${extension}`;

    // Upload to WordPress
    const uploadResponse = await fetch(`${apiUrl}/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': contentType,
      },
      body: imageBlob,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload image: ${uploadResponse.status}`);
    }

    const media = await uploadResponse.json();

    // Update alt text
    if (altText) {
      await fetch(`${apiUrl}/media/${media.id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ alt_text: altText }),
      });
    }

    return media.id;
  } catch (error) {
    console.error('Featured image upload error:', error);
    return null;
  }
}

// Get or create WordPress taxonomy terms (categories/tags)
async function getOrCreateTerms(
  apiUrl: string,
  auth: string,
  taxonomy: 'categories' | 'tags',
  terms: string[]
): Promise<number[]> {
  const termIds: number[] = [];

  for (const termName of terms) {
    try {
      // Search for existing term
      const searchResponse = await fetch(
        `${apiUrl}/${taxonomy}?search=${encodeURIComponent(termName)}`,
        {
          headers: { 'Authorization': `Basic ${auth}` },
        }
      );

      if (searchResponse.ok) {
        const existingTerms = await searchResponse.json();
        const exactMatch = existingTerms.find(
          (t: any) => t.name.toLowerCase() === termName.toLowerCase()
        );

        if (exactMatch) {
          termIds.push(exactMatch.id);
          continue;
        }
      }

      // Create new term if not found
      const createResponse = await fetch(`${apiUrl}/${taxonomy}`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: termName }),
      });

      if (createResponse.ok) {
        const newTerm = await createResponse.json();
        termIds.push(newTerm.id);
      }
    } catch (error) {
      console.error(`Failed to process ${taxonomy} term "${termName}":`, error);
    }
  }

  return termIds;
}

// Update Yoast SEO meta fields (if Yoast plugin is installed)
async function updateYoastMeta(
  apiUrl: string,
  auth: string,
  postId: number,
  metaDescription?: string,
  focusKeyword?: string
): Promise<void> {
  const yoastMeta: any = {};

  if (metaDescription) {
    yoastMeta.yoast_wpseo_metadesc = metaDescription;
  }
  if (focusKeyword) {
    yoastMeta.yoast_wpseo_focuskw = focusKeyword;
  }

  if (Object.keys(yoastMeta).length === 0) return;

  const response = await fetch(`${apiUrl}/posts/${postId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ meta: yoastMeta }),
  });

  if (!response.ok) {
    throw new Error(`Yoast update failed: ${response.status}`);
  }
}
