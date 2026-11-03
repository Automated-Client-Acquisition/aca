import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import OpenRouterProvider from '../_shared/providers/OpenRouterProvider.ts';

// Decrypt API key using AES-256-GCM
async function decryptApiKey(encryptedKey: string, encryptionKeyHex: string): Promise<string> {
  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const binaryString = atob(encryptedKey);
  const encryptedBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    encryptedBytes[i] = binaryString.charCodeAt(i);
  }
  
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);

  const decryptedBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decryptedBytes);
}

// Fetch page content via crawl4ai (headless browser — handles JS-rendered pages and Cloudflare)
async function fetchWithCrawl4ai(url: string, crawlerBaseUrl: string, timeoutMs = 60_000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    console.log(`crawl4ai: fetching ${url}...`);
    const response = await fetch(`${crawlerBaseUrl}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: [url],
        crawler_config: {
          type: 'CrawlerRunConfig',
          params: {
            cache_mode: 'bypass',
            word_count_threshold: 50,
            delay_before_return_html: 2.0,
          },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`crawl4ai failed for ${url}: HTTP ${response.status}`);
      return null;
    }

    const result = await response.json();
    const crawlResult = result?.results?.[0];
    const markdown = crawlResult?.markdown?.raw_markdown;

    if (!markdown || markdown.length < 50) {
      console.log(`crawl4ai returned insufficient content for ${url}: ${markdown?.length || 0} chars`);
      return null;
    }

    console.log(`crawl4ai succeeded for ${url}: ${markdown.length} chars of markdown`);
    return markdown.substring(0, 50000);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log(`crawl4ai timed out for ${url} after ${timeoutMs}ms`);
    } else {
      console.error(`crawl4ai error for ${url}:`, error);
    }
    return null;
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
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (!user) throw new Error('Unauthorized');

    const { data: userData } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();

    const orgId = userData?.active_organization_id || userData?.organization_id;

    console.log('=== Scrape and Analyze Product ===');
    console.log('URL:', url);
    console.log('Organization ID:', orgId);

    // Get encryption key from environment
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    // Get organization settings for default model (optional)
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', orgId)
      .maybeSingle();

    const defaultModel = orgSettings?.default_llm_model || 'anthropic/claude-3.5-sonnet';

    // Get OpenRouter API key
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'openrouter')
      .maybeSingle();

    if (!apiKeyData) {
      throw new Error('OpenRouter API key not configured');
    }

    const openRouterKey = await decryptApiKey(
      apiKeyData.key_encrypted,
      encryptionKey
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: any) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // Step 1: Fetch webpage via crawl4ai (headless browser)
          sendEvent({ status: 'fetching', message: 'Fetching webpage...' });

          const crawlerBaseUrl = Deno.env.get('CRAWLER_BASE_URL');
          let pageText: string | null = null;

          if (crawlerBaseUrl) {
            pageText = await fetchWithCrawl4ai(url, crawlerBaseUrl);
          }

          if (!pageText) {
            // Fallback: basic fetch (works for simple sites without JS/Cloudflare)
            console.log(crawlerBaseUrl ? 'crawl4ai failed, falling back to basic fetch' : 'CRAWLER_BASE_URL not set, using basic fetch');
            const pageResponse = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            });
            if (!pageResponse.ok) {
              throw new Error(`Failed to fetch page: ${pageResponse.status}`);
            }
            const html = await pageResponse.text();
            // Basic HTML text extraction (fallback only)
            let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
            text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
            text = text.replace(/<[^>]+>/g, ' ');
            text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            pageText = text.replace(/\s+/g, ' ').trim().substring(0, 50000);
          }

          // Step 2: Analyze with AI
          sendEvent({ status: 'analyzing', message: 'Analyzing product with AI...' });

          const systemPrompt = `You are an expert product analyst and marketing strategist. Analyze the product page and extract/infer comprehensive product information.

**CRITICAL**: ALL fields must be populated. Never return null for ICP, marketing, or affiliate fields. If information isn't explicit on the page, INFER it intelligently based on the product type, industry, features, and target market.

Return a JSON object with this FLAT structure:

{
  "name": "Product name",
  "description": "Comprehensive product description (2-3 sentences)",
  "category": "Product category",
  "brand": "Brand name",
  "sku": "Product SKU/model (if found)",
  "price": 99.99,
  "currency": "USD",
  "images": ["image_url1", "image_url2"],
  "videos": ["video_url1"],
  "features": ["feature1", "feature2", "feature3"],
  "specifications": {"spec_name": "spec_value"},
  "tags": ["tag1", "tag2", "tag3"],
  
  "icp_age_range": "Age range of ideal customers (e.g., '25-45', '18-35', '30-60')",
  "icp_gender": "Target gender (e.g., 'all genders', 'primarily male', 'primarily female')",
  "icp_income": "Income level (e.g., 'middle to high', 'high income', 'all income levels')",
  "icp_location": "Geographic target (e.g., 'global', 'urban areas', 'North America', 'tech hubs')",
  "icp_job_titles": ["job title 1", "job title 2", "job title 3"] (3-5 specific roles),
  "icp_psychographics": ["psychographic 1", "psychographic 2", "psychographic 3"] (3-5 traits/values),
  "icp_pain_points": ["pain point 1", "pain point 2", "pain point 3"] (3-5 specific problems this solves),
  "icp_desires": ["desire 1", "desire 2", "desire 3"] (3-5 aspirations/goals),
  "icp_buying_motivations": ["motivation 1", "motivation 2", "motivation 3"] (3-5 reasons to buy),
  
  "marketing_primary_angle": "Main value proposition in one compelling sentence",
  "marketing_hooks": ["hook 1", "hook 2", "hook 3", "hook 4", "hook 5"] (5-7 attention-grabbing headlines),
  "marketing_urgency_factors": ["urgency 1", "urgency 2", "urgency 3"] (3-5 scarcity/timing elements),
  "marketing_alternative_angles": ["angle 1", "angle 2", "angle 3"] (3-5 different positioning approaches),
  "marketing_emotional_triggers": ["trigger 1", "trigger 2", "trigger 3"] (3-5 emotions to activate),
  
  "affiliate_key_messages": ["message 1", "message 2", "message 3"] (3-5 core talking points),
  "affiliate_content_ideas": ["idea 1", "idea 2", "idea 3", "idea 4"] (4-6 content formats/topics),
  "affiliate_calls_to_action": ["cta 1", "cta 2", "cta 3"] (3-5 conversion phrases),
  "affiliate_target_platforms": ["platform 1", "platform 2", "platform 3"] (3-5 best channels),
  "affiliate_recommended_approach": "2-3 sentence strategy for promoting this product as an affiliate"
}

**EXAMPLES OF GOOD OUTPUTS:**

For a SaaS tool:
- icp_job_titles: ["Software Engineers", "Product Managers", "Engineering Leads", "CTOs", "Tech Startup Founders"]
- icp_pain_points: ["Wasting time on manual workflows", "Difficulty integrating multiple tools", "High costs of no-code alternatives", "Lack of technical control"]
- marketing_hooks: ["Build AI agents in minutes, not weeks", "500+ integrations, zero vendor lock-in", "The workflow automation platform developers actually love"]

For an e-commerce product:
- icp_psychographics: ["Health-conscious", "Values convenience", "Environmentally aware", "Quality-focused"]
- marketing_emotional_triggers: ["Confidence", "Pride", "FOMO", "Belonging", "Self-improvement"]
- affiliate_content_ideas: ["Unboxing video review", "Before/after comparison", "How-to tutorial series", "Lifestyle integration showcase"]

**RULES:**
1. ALL arrays must have 3-7 items (not 1-2, not 10+)
2. Be specific and actionable, not generic
3. Base insights on product type, industry, and target market
4. Every field must have a meaningful value
5. Return ONLY valid JSON, no markdown formatting`;

          const userPrompt = `Analyze this product page and extract all relevant information:\n\nURL: ${url}\n\nPage Content:\n${pageText}`;

          const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openRouterKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': supabaseUrl,
            },
            body: JSON.stringify({
              model: defaultModel,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: 0.7,
              max_tokens: 16000,
              response_format: { type: 'json_object' },
            }),
          });

          if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            console.error('OpenRouter error:', aiResponse.status, errorText);
            let detail = errorText.slice(0, 300);
            try {
              const parsed = JSON.parse(errorText);
              detail = parsed?.error?.message || parsed?.message || detail;
            } catch { /* keep raw */ }
            throw new Error(`AI analysis failed (${aiResponse.status}): ${detail}`);
          }

          const aiData = await aiResponse.json();
          const choice = aiData.choices?.[0];
          const content = choice?.message?.content;
          const finishReason = choice?.finish_reason;

          if (!content) {
            throw new Error(`No content in AI response (finish_reason: ${finishReason ?? 'unknown'})`);
          }

          if (finishReason === 'length') {
            console.error('AI response truncated by max_tokens. Tail:', content.slice(-300));
            throw new Error(`AI response truncated (model: ${defaultModel}, finish_reason: length). Try a model with a larger output window or reduce required fields.`);
          }

          // Parse JSON from response
          let productData;
          try {
            productData = OpenRouterProvider.parseJsonResponse(content);

            console.log('Parsed product data:', {
              hasICP: !!productData.icp_age_range,
              hasMarketing: !!productData.marketing_primary_angle,
              hasAffiliate: !!productData.affiliate_key_messages,
              icpFields: Object.keys(productData).filter(k => k.startsWith('icp_')),
              marketingFields: Object.keys(productData).filter(k => k.startsWith('marketing_')),
              affiliateFields: Object.keys(productData).filter(k => k.startsWith('affiliate_'))
            });
          } catch (e) {
            console.error('Failed to parse AI response:', e);
            console.error('AI response content (first 500):', content?.slice(0, 500));
            console.error('AI response content (last 300):', content?.slice(-300));
            const parseDetail = e instanceof Error ? e.message : String(e);
            throw new Error(`Failed to parse product data (model: ${defaultModel}, finish_reason: ${finishReason ?? 'unknown'}): ${parseDetail}`);
          }

          // Send the complete product data
          sendEvent({ 
            status: 'complete', 
            message: 'Analysis complete',
            data: productData
          });

        } catch (error) {
          console.error('Error in scrape-and-analyze-product:', error);
          sendEvent({ 
            status: 'error', 
            message: error instanceof Error ? error.message : 'Unknown error'
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Error in scrape-and-analyze-product:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
