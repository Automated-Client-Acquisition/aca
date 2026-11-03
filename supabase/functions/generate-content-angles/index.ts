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
    const { product_id, idea_id, count = 3 } = await req.json();

    if (!product_id && !idea_id) {
      throw new Error('Either product_id or idea_id is required');
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

    console.log('=== Generate Content Angles Job ===');
    console.log('Product ID:', product_id);
    console.log('Idea ID:', idea_id);
    console.log('Organization ID:', orgId);

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .insert({
        organization_id: orgId,
        user_id: user.id,
        content_type: 'content-angle',
        status: 'queued',
        configuration: {
          product_id,
          idea_id,
          count
        },
        items: [],
        progress: { current: 0, total: count },
        cost: { estimated: 0, actual: 0 }
      })
      .select()
      .single();

    if (jobError || !job) {
      console.error('Failed to create job:', jobError);
      throw new Error('Failed to create generation job');
    }

    console.log('Created job:', job.id);

    // Start background generation
    const generateInBackground = async () => {
      try {
        await supabase
          .from('content_generation_jobs')
          .update({ status: 'processing', started_at: new Date().toISOString() })
          .eq('id', job.id);

        console.log('Starting background generation for job:', job.id);

        // Fetch context data
        const contextParts: string[] = [];

        if (product_id) {
          const { data: product } = await supabase
            .from('library_products')
            .select('*')
            .eq('id', product_id)
            .single();

          if (product) {
            let productContext = `PRODUCT DETAILS:\n`;
            productContext += `Name: ${product.name}\n`;
            if (product.brand) productContext += `Brand: ${product.brand}\n`;
            if (product.category) productContext += `Category: ${product.category}\n`;
            if (product.description) productContext += `Description: ${product.description}\n`;
            if (product.features?.length) productContext += `Features:\n${product.features.map((f: string) => `- ${f}`).join('\n')}\n`;
            if (product.tags?.length) productContext += `Tags: ${product.tags.join(', ')}\n`;
            
            // Add ICP context (now flat fields)
            if (product.icp_pain_points?.length) {
              productContext += `\nPain Points:\n${product.icp_pain_points.map((p: string) => `- ${p}`).join('\n')}\n`;
            }
            if (product.icp_job_titles?.length) {
              productContext += `Target Audience: ${product.icp_job_titles.join(', ')}\n`;
            }
            if (product.icp_desires?.length) {
              productContext += `Customer Desires:\n${product.icp_desires.map((d: string) => `- ${d}`).join('\n')}\n`;
            }
            
            contextParts.push(productContext);
          }
        }

        if (idea_id) {
          const { data: idea } = await supabase
            .from('content_ideas')
            .select('*, library_products(*)')
            .eq('id', idea_id)
            .single();

          if (idea) {
            let ideaContext = `CONTENT IDEA:\n`;
            ideaContext += `Title: ${idea.title}\n`;
            if (idea.keywords?.length) ideaContext += `Keywords: ${idea.keywords.join(', ')}\n`;
            const talkingPoints = idea.ai_analysis?.talking_points;
            if (talkingPoints?.length) ideaContext += `Key Points:\n${talkingPoints.map((p: string) => `- ${p}`).join('\n')}\n`;
            if (idea.emotional_triggers?.length) ideaContext += `Emotional Triggers: ${idea.emotional_triggers.join(', ')}\n`;
            if (idea.content_framework) ideaContext += `Framework: ${idea.content_framework}\n`;
            
            if (idea.library_products) {
              ideaContext += `\nRelated Product: ${idea.library_products.name}\n`;
              if (idea.library_products.description) ideaContext += `Product Description: ${idea.library_products.description}\n`;
            }
            
            contextParts.push(ideaContext);
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
          throw new Error('OpenRouter API key not configured');
        }

        const openRouterKey = apiKeyRecord ? await decryptApiKey(apiKeyRecord.key_encrypted, encryptionKey) : undefined;

        // Get default model from settings
        const { data: orgSettings } = await supabase
          .from('organization_settings')
          .select('default_llm_model')
          .eq('organization_id', orgId)
          .single();

        const model = orgSettings?.default_llm_model || 'google/gemini-2.0-flash-001';
        
        console.log('Using model:', model);

        // Build the prompt
        const systemPrompt = `You are an expert content strategist specializing in creating high-converting content angles.

Your task: Generate ${count} unique, compelling content angles that will drive engagement and conversions.

Each content angle should include:
1. A catchy NAME that captures the essence
2. A clear SUBJECT line
3. The ANGLE TYPE - must be ONE of these exact values:
   - comparison
   - tutorial
   - controversy
   - personal_story
   - listicle
   - prediction
   - problem_solution
   - behind_scenes
   - news_commentary
   - myth_busting
4. An attention-grabbing OPENING HOOK (3-5 seconds)
5. MAIN CONTENT structure and talking points
6. A compelling CLOSING CTA (call-to-action)
7. TARGET AUDIENCE description
8. Key PAIN POINTS addressed
9. EMOTIONAL TRIGGERS to use
10. PLATFORM FIT (which platforms this works best on)
11. VIRAL SCORE (1-10, how likely to go viral)
12. DIFFICULTY level - must be ONE of these exact values: easy, medium, hard

Make each angle DISTINCT from the others - different approaches, different emotional triggers, different target sub-audiences.

Return your response as valid JSON with this EXACT structure (no markdown, no extra text):
{
  "angles": [
    {
      "name": "Catchy angle name",
      "subject": "Clear subject line",
      "angle_type": "comparison",
      "opening_hook": "Compelling 3-5 second hook that grabs attention",
      "main_content": "Detailed content structure and key points to cover",
      "closing_cta": "Strong call-to-action that drives conversions",
      "target_audience": "Specific audience description",
      "pain_points": ["pain point 1", "pain point 2", "pain point 3"],
      "emotional_triggers": ["trigger1", "trigger2", "trigger3"],
      "platform_fit": ["youtube", "tiktok", "instagram", "linkedin"],
      "viral_score": 7,
      "difficulty": "easy"
    }
  ]
}`;

        const userPrompt = `${contextParts.join('\n---\n\n')}\n\nGenerate ${count} diverse, high-impact content angles based on the above context.`;

        // Call OpenRouter (non-streaming for background)
        const openRouterResponse = await fetchChatCompletions({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
        }, {
          openRouterApiKey: openRouterKey,
          supabase,
          organizationId: orgId,
          referer: supabaseUrl,
        });

        if (!openRouterResponse.ok) {
          const errorText = await openRouterResponse.text();
          console.error('OpenRouter error:', errorText);
          throw new Error('Failed to generate content angles');
        }

        const result = await openRouterResponse.json();
        const content = result.choices?.[0]?.message?.content || '';

        // Parse the response
        let parsedResponse;
        try {
          const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/```\n?([\s\S]*?)\n?```/);
          const jsonText = jsonMatch ? jsonMatch[1] : content;
          parsedResponse = JSON.parse(jsonText.trim());
        } catch (e) {
          console.error('Failed to parse response:', e);
          throw new Error('Failed to parse AI response');
        }

        // Insert content angles into database
        const angles = parsedResponse.angles || [];
        const insertedAngles = [];

        for (const angle of angles) {
          const { data: newAngle, error } = await supabase
            .from('library_content_angles')
            .insert({
              organization_id: orgId,
              product_id: product_id || null,
              name: angle.name,
              subject: angle.subject,
              angle_type: angle.angle_type,
              opening_hook: angle.opening_hook,
              main_content: angle.main_content,
              closing_cta: angle.closing_cta,
              target_audience: angle.target_audience,
              pain_points_addressed: angle.pain_points,
              emotional_triggers: angle.emotional_triggers,
              platform_fit: angle.platform_fit,
              viral_score: angle.viral_score,
              difficulty: angle.difficulty,
            })
            .select()
            .single();

          if (error) {
            console.error('Failed to insert angle:', error);
          } else {
            insertedAngles.push(newAngle);
          }
        }

        console.log(`Successfully generated ${insertedAngles.length} content angles`);

        // Update job as completed
        await supabase
          .from('content_generation_jobs')
          .update({ 
            status: 'completed',
            completed_at: new Date().toISOString(),
            items: insertedAngles,
            progress: { current: insertedAngles.length, total: count }
          })
          .eq('id', job.id);

        console.log('Job completed:', job.id);
      } catch (error) {
        console.error('Background generation error:', error);
        
        await supabase
          .from('content_generation_jobs')
          .update({ 
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id);
      }
    };

    // Start background task (Deno context doesn't need EdgeRuntime.waitUntil)
    generateInBackground();

    // Return immediately with job ID
    return new Response(
      JSON.stringify({ 
        job_id: job.id,
        status: 'queued',
        message: 'Content angle generation started'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error in generate-content-angles:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
