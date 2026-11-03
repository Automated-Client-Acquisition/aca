import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchChatCompletions, hasOllamaKey } from '../_shared/llm-client.ts';

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { 
      content_id, 
      brand_voice_id, 
      product_id, 
      content_angle_id 
    } = await req.json();

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

    console.log('=== Convert Content to Idea ===');
    console.log('Content ID:', content_id);
    console.log('Organization ID:', orgId);

    // Fetch scraped content
    const { data: scrapedContent, error: contentError } = await supabase
      .from('research_content')
      .select('*')
      .eq('id', content_id)
      .single();

    if (contentError || !scrapedContent) {
      throw new Error('Content not found');
    }

    // Check if already converted
    if (scrapedContent.converted_to_idea) {
      throw new Error('Content already converted to idea');
    }

    // Create initial content idea record
    const { data: newIdea, error: ideaError } = await supabase
      .from('content_ideas')
      .insert({
        organization_id: orgId,
        title: scrapedContent.title || 'Untitled Idea',
        brand_voice_id: brand_voice_id || null,
        product_id: product_id || null,
        content_angle_id: content_angle_id || null,
        generation_in_progress: true,
      })
      .select()
      .single();

    if (ideaError || !newIdea) {
      throw new Error('Failed to create content idea');
    }

    console.log('Created idea:', newIdea.id);

    // Fetch library elements for context
    const contextParts: string[] = [];

    // Extract transcript from raw_data
    const getTranscriptText = (rawData: any) => {
      const transcriptData = rawData?.transcript || rawData?.subtitles || rawData?.text;
      if (!transcriptData) return null;
      if (typeof transcriptData === 'string') return transcriptData;
      if (typeof transcriptData === 'object' && transcriptData.plaintext) return transcriptData.plaintext;
      if (Array.isArray(transcriptData)) {
        return transcriptData.map((item: any) => 
          typeof item === 'string' ? item : item.plaintext || item.text || ''
        ).join('\n');
      }
      return null;
    };

    const transcript = getTranscriptText(scrapedContent.raw_data);

    // Build content context
    let contentContext = `ORIGINAL CONTENT ANALYSIS:\n\n`;
    contentContext += `Platform: ${scrapedContent.platform}\n`;
    contentContext += `Title: ${scrapedContent.title || 'N/A'}\n`;
    if (scrapedContent.author_name) contentContext += `Creator: ${scrapedContent.author_name} (@${scrapedContent.author_handle || 'unknown'})\n`;
    contentContext += `\n`;
    
    // Add engagement metrics
    if (scrapedContent.engagement) {
      contentContext += `ENGAGEMENT METRICS (What Made This Successful):\n`;
      if (scrapedContent.engagement.viewCount) contentContext += `- Views: ${scrapedContent.engagement.viewCount.toLocaleString()}\n`;
      if (scrapedContent.engagement.likeCount) contentContext += `- Likes: ${scrapedContent.engagement.likeCount.toLocaleString()}\n`;
      if (scrapedContent.engagement.commentCount) contentContext += `- Comments: ${scrapedContent.engagement.commentCount.toLocaleString()}\n`;
      if (scrapedContent.engagement.shareCount) contentContext += `- Shares: ${scrapedContent.engagement.shareCount.toLocaleString()}\n`;
      contentContext += `\n`;
    }

    if (scrapedContent.description) {
      contentContext += `DESCRIPTION:\n${scrapedContent.description}\n\n`;
    }

    if (transcript) {
      contentContext += `FULL TRANSCRIPT:\n${transcript}\n\n`;
    }

    contextParts.push(contentContext);

    // Fetch brand voice if provided
    if (brand_voice_id) {
      const { data: bv } = await supabase
        .from('library_brand_voices')
        .select('name, description, tone, style_guidelines, dos, donts')
        .eq('id', brand_voice_id)
        .single();
      
      if (bv) {
        let bvContext = `YOUR BRAND VOICE:\n`;
        bvContext += `Name: ${bv.name}\n`;
        if (bv.description) bvContext += `Description: ${bv.description}\n`;
        if (bv.tone) bvContext += `Tone: ${bv.tone}\n`;
        if (bv.style_guidelines) bvContext += `Style Guidelines: ${bv.style_guidelines}\n`;
        if (bv.dos) bvContext += `Do's: ${JSON.stringify(bv.dos)}\n`;
        if (bv.donts) bvContext += `Don'ts: ${JSON.stringify(bv.donts)}\n`;
        contextParts.push(bvContext);
      }
    }

    // Fetch product if provided
    if (product_id) {
      const { data: prod } = await supabase
        .from('library_products')
        .select('name, description, features, icp, marketing_angles')
        .eq('id', product_id)
        .single();
      
      if (prod) {
        let prodContext = `YOUR PRODUCT:\n`;
        prodContext += `Name: ${prod.name}\n`;
        if (prod.description) prodContext += `Description: ${prod.description}\n`;
        if (prod.icp) prodContext += `Target Audience (ICP): ${prod.icp}\n`;
        if (prod.features) prodContext += `Key Features: ${JSON.stringify(prod.features)}\n`;
        if (prod.marketing_angles) prodContext += `Marketing Angles: ${JSON.stringify(prod.marketing_angles)}\n`;
        contextParts.push(prodContext);
      }
    }

    // Fetch content angle if provided
    if (content_angle_id) {
      const { data: angle } = await supabase
        .from('library_content_angles')
        .select('name, subject, angle_type, target_audience, emotional_triggers')
        .eq('id', content_angle_id)
        .single();
      
      if (angle) {
        let angleContext = `YOUR CONTENT ANGLE:\n`;
        angleContext += `Name: ${angle.name}\n`;
        if (angle.subject) angleContext += `Subject: ${angle.subject}\n`;
        if (angle.angle_type) angleContext += `Type: ${angle.angle_type}\n`;
        if (angle.target_audience) angleContext += `Target Audience: ${angle.target_audience}\n`;
        if (angle.emotional_triggers) angleContext += `Emotional Triggers: ${JSON.stringify(angle.emotional_triggers)}\n`;
        contextParts.push(angleContext);
      }
    }

    // Get OpenRouter API key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const { data: apiKeyRecord } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKeyRecord && !(await hasOllamaKey(supabase, orgId))) {
      throw new Error('OpenRouter API key not configured. Please add your OpenRouter API key in Settings.');
    }

    const openRouterKey = apiKeyRecord ? await decryptApiKey(apiKeyRecord.key_encrypted, encryptionKey) : undefined;

    // Get default model from settings
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', orgId)
      .single();

    // Use configured model or fallback to a reliable paid model
    const model = orgSettings?.default_llm_model || 'google/gemini-2.0-flash-001';
    
    if (!orgSettings?.default_llm_model) {
      console.log('No default model configured, using fallback:', model);
    } else {
      console.log('Using configured model:', model);
    }

    // Build the prompt
    const systemPrompt = `You are an expert content strategist analyzing viral social media content to extract deep, actionable insights AND make them 10% better.

Your mission: Thoroughly analyze the content's transcript, description, and engagement metrics to understand EXACTLY what made it successful, then CREATE IMPROVED VERSIONS that are 10% better than the original.

THE 10% BETTER FRAMEWORK:
When extracting talking points and hooks, don't just copy them - IMPROVE them by:
- Making them more specific and concrete (vague → precise)
- Adding stronger emotional triggers
- Improving clarity and punchiness
- Making claims more compelling or credible
- Adding unexpected angles or twists
- Strengthening the logical flow between points

CRITICAL ANALYSIS AREAS:

1. HOOKS ANALYSIS - Extract ALL hooks, then IMPROVE each one:
   - Opening hook (first 3-5 seconds)
   - Mid-content hooks that re-engage
   - Pattern interrupts
   - For each hook: original text, improved version (10% better), type, why it works psychologically, and timestamp

2. CTAs (Call-to-Actions) - Find ALL calls-to-action, then IMPROVE them:
   - Direct CTAs (subscribe, like, comment, buy, click)
   - Indirect CTAs (questions that prompt engagement)
   - Placement strategy
   - For each CTA: original and improved version

3. TALKING POINTS - Extract 6-10 detailed talking points AND MAKE THEM 10% BETTER:
   - For each point: provide BOTH the original AND an improved version
   - The improved version should be: more specific, more compelling, clearer, more actionable
   - Main arguments or themes
   - Supporting evidence or stories
   - How they build on each other
   - Which ones drove the most engagement

4. SCRIPT STRUCTURE - Map the full content flow:
   - Opening (first 30 seconds)
   - Body structure and transitions
   - Climax or key moment
   - Closing and final CTA

5. ENGAGEMENT DRIVERS - What specifically made people engage:
   - Psychological triggers used
   - Curiosity gaps created
   - Pattern interrupts
   - Value propositions
   - Entertainment vs education balance

6. VIRAL ELEMENTS - What made it shareable:
   - Unique angles or perspectives
   - Controversial or surprising elements
   - Emotional peaks
   - Quotable moments
   - Visual or storytelling techniques

Your response MUST be valid JSON with this EXACT structure (no markdown, no extra text):
{
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6"],
  "talking_points": [
    "IMPROVED talking point 1 (10% better version - more specific, compelling, actionable)",
    "IMPROVED talking point 2 (10% better version)",
    "IMPROVED talking point 3 (10% better version)",
    "IMPROVED talking point 4 (10% better version)",
    "IMPROVED talking point 5 (10% better version)",
    "IMPROVED talking point 6 (10% better version)"
  ],
  "original_talking_points": [
    "Original talking point 1 as extracted from content",
    "Original talking point 2 as extracted from content",
    "Original talking point 3 as extracted from content",
    "Original talking point 4 as extracted from content",
    "Original talking point 5 as extracted from content",
    "Original talking point 6 as extracted from content"
  ],
  "emotional_triggers": ["trigger1", "trigger2", "trigger3", "trigger4"],
  "content_framework": "Comprehensive framework: [Hook Type] → [Body Structure] → [Climax Strategy] → [CTA Approach]. Explain the full content architecture.",
  "ai_analysis": {
    "hooks": [
      {
        "original_text": "Exact hook text from content",
        "improved_text": "10% better version of the hook - more punchy, specific, or emotionally compelling",
        "type": "question|statement|story|statistic|challenge|pattern_interrupt",
        "why_it_works": "Psychological analysis of effectiveness",
        "improvement_notes": "What was changed and why it's better",
        "timestamp": "0:00-0:05 or position in text",
        "engagement_impact": "How this impacted watch time or engagement"
      }
    ],
    "ctas": [
      {
        "original_text": "Exact CTA text from content",
        "improved_text": "10% better version of the CTA",
        "placement": "opening|middle|end",
        "type": "subscribe|like|comment|share|link|buy|question",
        "effectiveness": "Analysis based on engagement metrics",
        "psychological_trigger": "What motivates compliance"
      }
    ],
    "script_structure": {
      "opening": "Detailed opening strategy and hook deployment",
      "body": "Content flow, transitions, and retention tactics",
      "climax": "Peak moment or key insight delivery",
      "closing": "How they wrap up and final CTA strategy"
    },
    "engagement_drivers": [
      "Specific driver 1 with explanation",
      "Specific driver 2 with explanation",
      "Specific driver 3 with explanation"
    ],
    "viral_elements": [
      "Unique angle or perspective that made it shareable",
      "Controversial or surprising element",
      "Emotional peak moments",
      "Quotable or memorable moments"
    ],
    "content_patterns": [
      "Pattern 1: e.g., Question → Story → Lesson → CTA",
      "Pattern 2: e.g., Bold claim → Evidence → Application",
      "Pattern 3: e.g., Problem → Agitation → Solution"
    ],
    "success_factors": "Comprehensive analysis of WHY this content performed well - include engagement metrics context",
    "adaptation_strategy": "Detailed strategy for how to adapt this for the user's brand voice and product, maintaining effectiveness",
    "platform_optimization": "Platform-specific tips for this content type and style",
    "audience_insights": "What this content reveals about the target audience's desires, fears, and preferences",
    "repurposing_ideas": [
      "Specific repurposing idea 1",
      "Specific repurposing idea 2",
      "Specific repurposing idea 3",
      "Specific repurposing idea 4"
    ],
    "improvement_summary": {
      "talking_points_improvements": "Summary of how the talking points were made 10% better",
      "hooks_improvements": "Summary of how hooks were enhanced",
      "ctas_improvements": "Summary of how CTAs were strengthened",
      "overall_enhancement": "Brief explanation of the key improvements that will make this content outperform the original"
    }
  }
}

IMPORTANT:
- Extract EVERY hook and CTA you can find. Be thorough and specific.
- The talking_points array (inside ai_analysis) should contain the IMPROVED versions (10% better).
- Always provide both original and improved versions so users can see the enhancement.
- Focus on making improvements that are realistic and achievable - not a complete rewrite, but meaningful enhancements.`;

    const userPrompt = contextParts.join('\n---\n\n');

    // Call OpenRouter with streaming
    const openRouterResponse = await fetchChatCompletions({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: true,
    }, {
      openRouterApiKey: openRouterKey,
      supabase,
      organizationId: orgId,
      referer: supabaseUrl,
    });

    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text();
      console.error('OpenRouter error:', errorText);
      
      let errorMessage = 'Failed to generate content idea';
      let shouldSuggestUpgrade = false;
      
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.error?.metadata?.raw) {
          errorMessage = errorData.error.metadata.raw;
          // Check if it's a rate limit on free model
          if (errorMessage.includes('rate-limited') && model.includes('free')) {
            shouldSuggestUpgrade = true;
            errorMessage = `The free model "${model}" is currently rate-limited. Please wait a moment and try again, or upgrade to a paid OpenRouter model in Settings for higher limits.`;
          }
        } else if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch (e) {
        errorMessage = `OpenRouter API error (${openRouterResponse.status}). Please check your API key and model settings.`;
      }
      
      // Delete the created idea since we failed
      await supabase.from('content_ideas').delete().eq('id', newIdea.id);
      
      throw new Error(errorMessage);
    }

    // Stream response back to client
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const reader = openRouterResponse.body?.getReader();
          if (!reader) throw new Error('No response body');

          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            buffer += chunk;

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }

          // Process any remaining buffer
          if (buffer.trim()) {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data !== '[DONE]') {
                  try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content;
                    if (content) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, idea_id: newIdea.id })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.error(error);
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
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
