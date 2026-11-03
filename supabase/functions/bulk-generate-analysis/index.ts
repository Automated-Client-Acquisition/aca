import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { retrieveChunksByDocIds } from '../_shared/knowledge-retrieval.ts';
import { fetchChatCompletions, hasOllamaKey } from '../_shared/llm-client.ts';
import { resolveBrandKitIds } from '../_shared/library-defaults.ts';
import { GROUNDING_RULES, SUGGESTED_POINT_COUNT, cleanList, draftPoints } from '../_shared/idea-guidelines.ts';

// Decrypt API key using AES-256-GCM
async function decryptApiKey(encryptedKey: string, encryptionKeyHex: string): Promise<string> {
  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const binaryString = atob(encryptedKey);
  const encryptedBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    encryptedBytes[i] = binaryString.charCodeAt(i);
  }
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);
  const decryptedBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
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
      idea_ids,
      brand_voice_id: requestedBrandVoiceId,
      product_id: requestedProductId,
      content_angle_id,
      knowledge_document_ids,
      additional_directions,
    } = await req.json();

    if (!idea_ids || !Array.isArray(idea_ids) || idea_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'idea_ids is required and must be a non-empty array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    // Nothing picked: enrich with the Brand Kit (default, else most recent), like runs do.
    const brandKit = orgId ? await resolveBrandKitIds(supabase as any, orgId, ['brand', 'product', 'audience']) : {};
    const brand_voice_id = requestedBrandVoiceId || brandKit.brand || null;
    const product_id = requestedProductId || brandKit.product || null;
    const audience_id = brandKit.audience || null;

    // Get OpenRouter API key
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKeyData && !(await hasOllamaKey(supabase, orgId))) {
      return new Response(
        JSON.stringify({ error: 'OpenRouter API key not configured. Please add it in Settings > API Keys.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      return new Response(
        JSON.stringify({ error: 'Encryption key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const decryptedApiKey = apiKeyData ? await decryptApiKey(apiKeyData.key_encrypted, encryptionKey) : undefined;

    // Get default model
    const { data: settings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', orgId)
      .single();

    const model = settings?.default_llm_model || 'meta-llama/llama-3.3-70b-instruct';

    // Fetch library elements once (shared across all ideas)
    let brandVoiceContext = '';
    if (brand_voice_id) {
      const { data: bv } = await supabase
        .from('library_brand_voices')
        .select('name, description, tone, style_guidelines, dos, donts, examples')
        .eq('id', brand_voice_id)
        .single();
      if (bv) {
        brandVoiceContext = `Brand Voice: ${bv.name}\n`;
        if (bv.description) brandVoiceContext += `Description: ${bv.description}\n`;
        if (bv.tone) brandVoiceContext += `Tone: ${bv.tone}\n`;
        if (bv.style_guidelines) brandVoiceContext += `Style Guidelines: ${bv.style_guidelines}\n`;
        if (bv.dos) brandVoiceContext += `Do's: ${JSON.stringify(bv.dos)}\n`;
        if (bv.donts) brandVoiceContext += `Don'ts: ${JSON.stringify(bv.donts)}\n`;
        if (bv.examples) brandVoiceContext += `Examples: ${JSON.stringify(bv.examples)}\n`;
      }
    }

    let productContext = '';
    if (product_id) {
      const { data: prod } = await supabase
        .from('library_products')
        .select('*')
        .eq('id', product_id)
        .single();
      if (prod) {
        productContext = `Product: ${prod.name}\n`;
        if (prod.description) productContext += `Description: ${prod.description}\n`;
        if (prod.features?.length) productContext += `Features: ${prod.features.join(', ')}\n`;
        if (prod.icp_pain_points?.length) productContext += `Pain Points: ${prod.icp_pain_points.join(', ')}\n`;
        if (prod.marketing_primary_angle) productContext += `Primary Angle: ${prod.marketing_primary_angle}\n`;
        if (prod.marketing_hooks?.length) productContext += `Marketing Hooks: ${prod.marketing_hooks.join(', ')}\n`;
      }
    }

    let audienceContext = '';
    if (audience_id) {
      const { data: icp } = await supabase
        .from('library_icps')
        .select('name, summary, description, pain_points, desires, objections, language_style')
        .eq('id', audience_id)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (icp) {
        audienceContext = `Audience: ${icp.name}\n`;
        const about = icp.summary || icp.description;
        if (about) audienceContext += `${about}\n`;
        if (icp.pain_points?.length) audienceContext += `Their pains: ${icp.pain_points.join(', ')}\n`;
        if (icp.desires?.length) audienceContext += `What they want: ${icp.desires.join(', ')}\n`;
        if (icp.objections?.length) audienceContext += `Their objections: ${icp.objections.join(', ')}\n`;
        if (icp.language_style) audienceContext += `How they talk: ${icp.language_style}\n`;
      }
    }

    let angleContext = '';
    if (content_angle_id) {
      const { data: angle } = await supabase
        .from('library_content_angles')
        .select('name, angle_type, subject, target_audience, emotional_triggers, pain_points_addressed')
        .eq('id', content_angle_id)
        .single();
      if (angle) {
        angleContext = `Content Angle: ${angle.name}\n`;
        if (angle.angle_type) angleContext += `Type: ${angle.angle_type}\n`;
        if (angle.subject) angleContext += `Subject: ${angle.subject}\n`;
        if (angle.target_audience) angleContext += `Target Audience: ${angle.target_audience}\n`;
      }
    }

    // Fetch all ideas
    const { data: ideas, error: ideasError } = await supabase
      .from('content_ideas')
      .select('id, title, ai_analysis, metadata, free_text')
      .in('id', idea_ids);

    if (ideasError || !ideas) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch ideas' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark all ideas as generating
    await supabase
      .from('content_ideas')
      .update({ generation_in_progress: true })
      .in('id', idea_ids);

    console.log(`[Bulk Analysis] Starting for ${ideas.length} ideas, model: ${model}`);

    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];

      try {
        // Build context for this idea
        const contextParts: string[] = [`Title/Topic: ${idea.title}`];
        if (idea.free_text) contextParts.push(`Notes on this topic (source material):\n${idea.free_text}`);
        if (brandVoiceContext) contextParts.push(brandVoiceContext);
        if (productContext) contextParts.push(productContext);
        if (audienceContext) contextParts.push(audienceContext);
        if (angleContext) contextParts.push(angleContext);
        if (additional_directions) contextParts.push(`Additional Instructions: ${additional_directions}`);

        // KB RAG retrieval per idea
        if (knowledge_document_ids && knowledge_document_ids.length > 0) {
          try {
            const kbQuery = `${idea.title} ${contextParts.slice(1).map(p => p.split('\n')[0]).join(' ')}`.trim();
            const kbResult = await retrieveChunksByDocIds(supabase, orgId, knowledge_document_ids, kbQuery, decryptedApiKey, 5);
            if (kbResult.chunks.length > 0) {
              const kbContext = kbResult.chunks.map((chunk, j) => `[${j + 1}] ${chunk.content}`).join('\n\n---\n\n');
              contextParts.push(`**KNOWLEDGE BASE — HOOK TEMPLATES & WRITING PATTERNS**:\nBelow are proven hook templates, frameworks, and writing patterns from the user's swipe file. You MUST use these as direct templates for generating hooks — take the exact structural pattern (e.g. "I just [action] and here is what I learned", "Your [thing] is broken. Here is proof.", "[Number]% of [audience] fail at [thing]") and fill in the blanks with the specific idea topic above. Match the tone, rhythm, cadence, and psychological triggers of these examples. The hooks you generate should feel like they came from this same swipe file, applied to the idea topic:\n\n${kbContext}`);
            }
          } catch (kbError) {
            console.warn(`[Bulk Analysis] KB retrieval failed for idea ${idea.id} (non-fatal):`, kbError);
          }
        }

        const systemPrompt = `You are an expert content strategist creating comprehensive content blueprints.

CRITICAL: You MUST deeply integrate and reflect ALL provided context in your response:
- If a Brand Voice is provided, match its tone, style guidelines, do's and don'ts precisely
- If a Product is provided, incorporate its features, benefits, ICP, and marketing angles naturally
- If a Content Angle is provided, follow its structure, hooks, emotional triggers, and pain points

ANALYSIS REQUIREMENTS:

1. HOOKS - Generate 5 diverse, high-converting hooks:
   - Each hook must have: exact text, type (question/statement/story/statistic/challenge/pattern_interrupt), psychological reasoning, and application context

2. CTAs (Call-to-Actions) - Create 5 strategic CTAs:
   - Each CTA must have: exact text, optimal placement (opening/middle/end), type (subscribe/like/comment/share/link/buy/question), effectiveness strategy, and psychological trigger

3. CONTENT STRUCTURE - Map the complete flow:
   - Opening strategy and hook deployment
   - Body structure with transitions and retention tactics
   - Climax or key insight delivery moment
   - Closing and final CTA strategy

4. ENGAGEMENT & VIRAL ELEMENTS:
   - Specific engagement drivers with explanations
   - Unique angles or perspectives
   - Emotional peaks and quotable moments

Your response MUST be valid JSON with this EXACT structure (no markdown, no extra text):
{
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6"],
  "emotional_triggers": ["trigger1", "trigger2", "trigger3", "trigger4"],
  "content_framework": "Comprehensive framework description.",
  "ai_analysis": {
    "talking_points": [
      "One-sentence point the post has to make",
      "One-sentence point the post has to make",
      "One-sentence point the post has to make",
      "One-sentence point the post has to make"
    ],
    "hooks": [
      {
        "text": "Hook text",
        "type": "question|statement|story|statistic|challenge|pattern_interrupt",
        "why_it_works": "Psychological analysis",
        "application_context": "When and how to use",
        "engagement_impact": "Expected impact"
      }
    ],
    "ctas": [
      {
        "text": "CTA text",
        "placement": "opening|middle|end",
        "type": "subscribe|like|comment|share|link|buy|question",
        "effectiveness": "Strategy",
        "psychological_trigger": "Motivation"
      }
    ],
    "script_structure": {
      "opening": "Opening strategy",
      "body": "Content flow",
      "climax": "Peak moment",
      "closing": "Wrap-up strategy"
    },
    "engagement_drivers": ["Driver 1", "Driver 2", "Driver 3"],
    "viral_elements": ["Element 1", "Element 2", "Element 3"],
    "content_patterns": ["Pattern 1", "Pattern 2", "Pattern 3"]
  }
}

IMPORTANT: Generate COMPREHENSIVE, actionable content with ALL fields filled. Write exactly ${SUGGESTED_POINT_COUNT} talking points.

${GROUNDING_RULES}`;

        const userPrompt = `Generate a content idea based on:\n\n${contextParts.join('\n\n')}`;

        // Call OpenRouter (non-streaming for bulk)
        const openRouterResponse = await fetchChatCompletions({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 8000,
          }, {
            openRouterApiKey: decryptedApiKey,
            supabase,
            organizationId: orgId,
            referer: supabaseUrl,
          });

        if (!openRouterResponse.ok) {
          const errorText = await openRouterResponse.text();
          throw new Error(`OpenRouter API error: ${openRouterResponse.status} - ${errorText.substring(0, 200)}`);
        }

        const aiResponse = await openRouterResponse.json();
        const fullContent = aiResponse.choices?.[0]?.message?.content || '';
        console.log(`[Bulk Analysis] Idea ${i + 1} raw response length: ${fullContent.length}, first 200 chars: ${fullContent.substring(0, 200)}`);

        // Parse JSON from response
        let cleanContent = fullContent.trim();
        const codeBlockMatch = cleanContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) cleanContent = codeBlockMatch[1].trim();

        const firstBrace = cleanContent.indexOf('{');
        if (firstBrace === -1) throw new Error('No JSON object found in response');

        let braceCount = 0;
        let endIndex = -1;
        let inString = false;
        let escapeNext = false;

        for (let k = firstBrace; k < cleanContent.length; k++) {
          const char = cleanContent[k];
          if (escapeNext) { escapeNext = false; continue; }
          if (char === '\\') { escapeNext = true; continue; }
          if (char === '"') { inString = !inString; continue; }
          if (!inString) {
            if (char === '{') braceCount++;
            if (char === '}') {
              braceCount--;
              if (braceCount === 0) { endIndex = k + 1; break; }
            }
          }
        }

        if (endIndex === -1) throw new Error('No complete JSON object found');

        const result = JSON.parse(cleanContent.substring(firstBrace, endIndex));

        if (!result.ai_analysis || !result.keywords) {
          throw new Error('AI response missing required fields');
        }

        // Keep the idea's guidelines: existing points and the avoid list stay,
        // new points only fill an idea that had none (as AI drafts). Metadata
        // is merged so the source link (Trending, Signals) survives.
        const existingAnalysis = idea.ai_analysis && typeof idea.ai_analysis === 'object' ? idea.ai_analysis : {};
        const currentPoints = cleanList(existingAnalysis.talking_points);
        const newAnalysis: Record<string, any> = { ...result.ai_analysis };
        if (currentPoints.length > 0) {
          newAnalysis.talking_points = currentPoints;
          newAnalysis.talking_points_ai = draftPoints(existingAnalysis, currentPoints);
        } else {
          const suggested = cleanList(newAnalysis.talking_points).slice(0, SUGGESTED_POINT_COUNT);
          newAnalysis.talking_points = suggested;
          newAnalysis.talking_points_ai = suggested;
        }
        if (existingAnalysis.avoid !== undefined) newAnalysis.avoid = existingAnalysis.avoid;

        // Update the idea in the database — sets generation_in_progress: false per idea
        const { error: updateError } = await supabase
          .from('content_ideas')
          .update({
            ai_analysis: newAnalysis,
            emotional_triggers: result.emotional_triggers,
            content_framework: result.content_framework,
            keywords: result.keywords,
            generation_in_progress: false,
            metadata: {
              ...(idea.metadata && typeof idea.metadata === 'object' ? idea.metadata : {}),
              hooks: result.ai_analysis?.hooks || [],
              ctas: result.ai_analysis?.ctas || [],
              generated_at: new Date().toISOString(),
              model_used: model,
              bulk_generated: true,
            },
          })
          .eq('id', idea.id);

        if (updateError) throw new Error(`DB update failed: ${updateError.message}`);

        successful++;
        console.log(`[Bulk Analysis] ✓ Completed idea ${i + 1}/${ideas.length}: ${idea.title.substring(0, 50)}`);

      } catch (ideaError) {
        failed++;
        const errorMsg = ideaError instanceof Error ? ideaError.message : 'Unknown error';
        errors.push(`${idea.title}: ${errorMsg}`);
        console.error(`[Bulk Analysis] ✗ Failed idea ${idea.id}:`, errorMsg);

        // Clear generation flag on error
        await supabase
          .from('content_ideas')
          .update({ generation_in_progress: false })
          .eq('id', idea.id);
      }
    }

    console.log(`[Bulk Analysis] Done: ${successful} succeeded, ${failed} failed`);

    return new Response(
      JSON.stringify({ successful, failed, errors }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const status = error instanceof Error && error.message.includes('Unauthorized') ? 401 : 500;
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
