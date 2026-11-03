import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { DEFAULT_FREE_TEXT_MODEL } from '../_shared/default-models.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { outputId, ideaContext, scenePrompts, libraryContext, instructions } = await req.json();

    console.log('Generating video caption for output:', outputId, instructions ? `with instructions: ${instructions}` : '');

    // Fetch output data to get context
    const { data: output, error: outputError } = await supabase
      .from('content_outputs')
      .select('*, content_ideas(title, metadata), generation_params, stage_data')
      .eq('id', outputId)
      .single();

    if (outputError || !output) {
      throw new Error('Output not found');
    }

    // Get organization for API key
    const { data: userData } = await supabase.auth.getUser();
    const { data: user } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', userData.user?.id)
      .single();

    const orgId = user?.organization_id;

    // Get OpenRouter API key
    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    // Decrypt key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const decryptedKey = await decryptApiKey(apiKey.key_encrypted, encryptionKey);

    // Extract context for caption generation
    const stageData = output.stage_data as any;
    const scenes = stageData?.scene_prompts?.scenes || scenePrompts || [];
    const params = output.generation_params as any;

    // Build context for AI with full library context
    const ideaTitle = output.content_ideas?.title || ideaContext || 'Video content';
    const ideaMetadata = output.content_ideas?.metadata as any;

    // Brand voice context (name + description for tone guidance)
    const brandVoiceName = params?.brand_voice?.name || params?.brand_voice;
    const brandVoiceDescription = params?.brand_voice?.description || '';
    const brandVoiceTone = params?.brand_voice?.tone || '';

    // Product context (name + description + key features)
    const productName = params?.product?.name || params?.product;
    const productDescription = params?.product?.description || '';
    const productKeywords = params?.product?.keywords?.join(', ') || '';

    // Angle/block context
    const angleName = params?.block?.name || params?.angle;
    const angleDescription = params?.block?.description || '';

    // Build scene summary
    const sceneContext = scenes.length > 0
      ? `Video scenes:\n${scenes.map((s: any, i: number) => `Scene ${i + 1}: ${s.prompt || s.description}`).join('\n')}`
      : '';

    // Build comprehensive prompt with all library context
    const systemPrompt = `You are a social media caption expert. Generate engaging captions for video content that will be published to TikTok, Instagram Reels, and YouTube Shorts.

## Video Context
**Topic/Title:** ${ideaTitle}
${ideaMetadata?.hook ? `**Hook/Angle:** ${ideaMetadata.hook}` : ''}

${brandVoiceName ? `## Brand Voice
**Name:** ${brandVoiceName}
${brandVoiceDescription ? `**Style:** ${brandVoiceDescription}` : ''}
${brandVoiceTone ? `**Tone:** ${brandVoiceTone}` : ''}` : ''}

${productName ? `## Product/Service
**Name:** ${productName}
${productDescription ? `**Description:** ${productDescription}` : ''}
${productKeywords ? `**Keywords:** ${productKeywords}` : ''}` : ''}

${angleName ? `## Content Angle
**Approach:** ${angleName}
${angleDescription ? `**Details:** ${angleDescription}` : ''}` : ''}

${sceneContext ? `## Video Scenes\n${sceneContext}` : ''}

## Caption Requirements
1. **Hook First** - Open with a pattern-interrupt that stops scrolling (question, bold statement, or curiosity gap)
2. **Match the Brand Voice** - Use the tone and style described above
3. **Keep it Punchy** - Primary message in first 150 characters (visible without "more")
4. **Include CTAs** - End with engagement prompt (comment, share, follow)
5. **Strategic Hashtags** - Add 3-5 relevant hashtags at the end

## Output Format
Return ONLY the caption text with hashtags. No labels, explanations, or metadata. The caption should be ready to copy-paste directly to social media.`;

    const userPrompt = `Generate a viral-worthy caption for this video: "${ideaTitle}"

${ideaMetadata?.description ? `Additional context: ${ideaMetadata.description}` : ''}
${instructions ? `\n## Special Instructions from User\n${instructions}\n` : ''}
Remember: Make it scroll-stopping, on-brand, and engagement-focused.`;

    // Call OpenRouter
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${decryptedKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': Deno.env.get('SUPABASE_URL') || '',
      },
      body: JSON.stringify({
        model: DEFAULT_FREE_TEXT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8, // Slightly higher for more creative captions
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter error:', response.status, errorText);
      throw new Error('Failed to generate caption');
    }

    const result = await response.json();
    const caption = result.choices[0].message.content.trim();

    // Store caption in stage_data.final.caption
    const updatedStageData = {
      ...stageData,
      final: {
        ...stageData?.final,
        caption,
        caption_generated_at: new Date().toISOString()
      }
    };

    const { error: updateError } = await supabase
      .from('content_outputs')
      .update({ stage_data: updatedStageData })
      .eq('id', outputId);

    if (updateError) {
      console.error('Failed to store caption:', updateError);
      throw updateError;
    }

    console.log('Caption generated and stored:', caption);

    return new Response(
      JSON.stringify({ success: true, caption }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Generate caption error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Decrypt API key using AES-256-GCM
async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  try {
    const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decryptedBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt API key');
  }
}
