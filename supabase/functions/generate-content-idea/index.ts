import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { retrieveChunksByDocIds } from '../_shared/knowledge-retrieval.ts';
import { fetchChatCompletions, hasOllamaKey } from '../_shared/llm-client.ts';
import { resolveBrandKitIds } from '../_shared/library-defaults.ts';
import { GROUNDING_RULES, SUGGESTED_POINT_COUNT, appendPoints, cleanList, draftPoints } from '../_shared/idea-guidelines.ts';

// Decrypt API key using AES-256-GCM
async function decryptApiKey(encryptedKey: string, encryptionKeyHex: string): Promise<string> {
  // Convert hex encryption key to bytes
  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  // Import the encryption key
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // Decode base64
  const binaryString = atob(encryptedKey);
  const encryptedBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    encryptedBytes[i] = binaryString.charCodeAt(i);
  }
  
  // Extract IV (first 12 bytes) and ciphertext
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);

  // Decrypt
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
      idea_id,
      title,
      brand_voice_id: requestedBrandVoiceId,
      product_id: requestedProductId,
      content_angle_id,
      generate_unique = false,
      section, // Optional: 'hooks', 'talking_points', or 'ctas' for section-specific generation
      additional_directions,
      knowledge_document_ids,
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

    // Nothing picked: write with the Brand Kit (default, else most recent), like runs do
    // (ideas used to be generated with no brand, product or audience at all).
    // The idea itself stays unlinked so later runs follow the current defaults.
    const brandKit = orgId ? await resolveBrandKitIds(supabase as any, orgId, ['brand', 'product', 'audience']) : {};
    const brand_voice_id = requestedBrandVoiceId || brandKit.brand || null;
    const product_id = requestedProductId || brandKit.product || null;
    const audience_id = brandKit.audience || null;

    console.log('=== Generate Content Idea Request ===');
    console.log('Idea ID:', idea_id);
    console.log('Title:', title);
    console.log('Organization ID:', orgId);
    console.log('Brand Voice ID:', brand_voice_id);
    console.log('Product ID:', product_id);
    console.log('Content Angle ID:', content_angle_id);
    console.log('Section (if specific):', section);
    console.log('Additional Directions:', additional_directions);
    console.log('Knowledge Document IDs:', knowledge_document_ids);

    // Fetch library elements for context
    const contextParts: string[] = [`Title/Topic: ${title}`];

    // The idea's own material: notes, source links, and for ideas saved from
    // Trending the source post's transcript. Points may only use facts from here
    // and the product (see GROUNDING_RULES).
    let ideaGuidelines: { points: string[]; avoid: string[] } = { points: [], avoid: [] };
    if (idea_id) {
      const { data: ideaData } = await supabase
        .from('content_ideas')
        .select('free_text, source_urls, metadata, ai_analysis')
        .eq('id', idea_id)
        .single();
      if (ideaData?.free_text) {
        contextParts.push(`Notes on this topic (source material):\n${ideaData.free_text}`);
      }
      if (ideaData?.source_urls) {
        contextParts.push(`Source links: ${String(ideaData.source_urls).split(/\s+/).filter(Boolean).join(', ')}`);
      }
      const researchId = ideaData?.metadata?.research_content_id;
      if (researchId) {
        const { data: research } = await supabase
          .from('research_content')
          .select('title, description, transcript')
          .eq('id', researchId)
          .eq('organization_id', orgId)
          .maybeSingle();
        const sourceText = [research?.title, research?.description, research?.transcript].filter(Boolean).join('\n').slice(0, 6000);
        if (sourceText) contextParts.push(`Source post (source material):\n${sourceText}`);
      }
      const analysis = ideaData?.ai_analysis && typeof ideaData.ai_analysis === 'object' ? ideaData.ai_analysis : {};
      ideaGuidelines = { points: cleanList(analysis.talking_points), avoid: cleanList(analysis.avoid) };
      if (ideaGuidelines.avoid.length) {
        contextParts.push(`Never mention: ${ideaGuidelines.avoid.join('; ')}`);
      }
    }

    if (brand_voice_id) {
      const { data: bv } = await supabase
        .from('library_brand_voices')
        .select('name, description, tone, style_guidelines, dos, donts, examples')
        .eq('id', brand_voice_id)
        .single();
      
      if (bv) {
        let bvContext = `Brand Voice: ${bv.name}\n`;
        if (bv.description) bvContext += `Description: ${bv.description}\n`;
        if (bv.tone) bvContext += `Tone: ${bv.tone}\n`;
        if (bv.style_guidelines) bvContext += `Style Guidelines: ${bv.style_guidelines}\n`;
        if (bv.dos) bvContext += `Do's: ${JSON.stringify(bv.dos)}\n`;
        if (bv.donts) bvContext += `Don'ts: ${JSON.stringify(bv.donts)}\n`;
        if (bv.examples) bvContext += `Examples: ${JSON.stringify(bv.examples)}\n`;
        contextParts.push(bvContext);
      }
    }

    if (product_id) {
      const { data: prod } = await supabase
        .from('library_products')
        .select('*')
        .eq('id', product_id)
        .single();
      
      if (prod) {
        let prodContext = `Product: ${prod.name}\n`;
        if (prod.brand) prodContext += `Brand: ${prod.brand}\n`;
        if (prod.category) prodContext += `Category: ${prod.category}\n`;
        if (prod.description) prodContext += `Description: ${prod.description}\n`;
        if (prod.features && prod.features.length > 0) prodContext += `Features: ${prod.features.join(', ')}\n`;
        if (prod.price) prodContext += `Price: ${prod.price} ${prod.currency || ''}\n`;
        
        // ICP Context (flat fields)
        if (prod.icp_pain_points?.length) {
          prodContext += `\nPain Points:\n${prod.icp_pain_points.map((p: string) => `- ${p}`).join('\n')}\n`;
        }
        if (prod.icp_job_titles?.length) {
          prodContext += `Target Audience: ${prod.icp_job_titles.join(', ')}\n`;
        }
        if (prod.icp_desires?.length) {
          prodContext += `Customer Desires:\n${prod.icp_desires.map((d: string) => `- ${d}`).join('\n')}\n`;
        }
        if (prod.icp_buying_motivations?.length) {
          prodContext += `Buying Motivations:\n${prod.icp_buying_motivations.map((m: string) => `- ${m}`).join('\n')}\n`;
        }
        if (prod.icp_psychographics?.length) {
          prodContext += `Psychographics: ${prod.icp_psychographics.join(', ')}\n`;
        }
        if (prod.icp_age_range) prodContext += `Age Range: ${prod.icp_age_range}\n`;
        if (prod.icp_gender) prodContext += `Gender: ${prod.icp_gender}\n`;
        if (prod.icp_income) prodContext += `Income Level: ${prod.icp_income}\n`;
        if (prod.icp_location) prodContext += `Location: ${prod.icp_location}\n`;
        
        // Marketing Context (flat fields)
        if (prod.marketing_primary_angle) {
          prodContext += `\nPrimary Marketing Angle: ${prod.marketing_primary_angle}\n`;
        }
        if (prod.marketing_hooks?.length) {
          prodContext += `Marketing Hooks:\n${prod.marketing_hooks.map((h: string) => `- ${h}`).join('\n')}\n`;
        }
        if (prod.marketing_urgency_factors?.length) {
          prodContext += `Urgency Factors:\n${prod.marketing_urgency_factors.map((f: string) => `- ${f}`).join('\n')}\n`;
        }
        if (prod.marketing_alternative_angles?.length) {
          prodContext += `Alternative Angles: ${prod.marketing_alternative_angles.join(', ')}\n`;
        }
        if (prod.marketing_emotional_triggers?.length) {
          prodContext += `Emotional Triggers: ${prod.marketing_emotional_triggers.join(', ')}\n`;
        }
        
        // Affiliate Context (flat fields)
        if (prod.affiliate_key_messages?.length) {
          prodContext += `\nKey Messages:\n${prod.affiliate_key_messages.map((m: string) => `- ${m}`).join('\n')}\n`;
        }
        if (prod.affiliate_content_ideas?.length) {
          prodContext += `Content Ideas:\n${prod.affiliate_content_ideas.map((i: string) => `- ${i}`).join('\n')}\n`;
        }
        if (prod.affiliate_calls_to_action?.length) {
          prodContext += `CTAs:\n${prod.affiliate_calls_to_action.map((c: string) => `- ${c}`).join('\n')}\n`;
        }
        if (prod.affiliate_target_platforms?.length) {
          prodContext += `Target Platforms: ${prod.affiliate_target_platforms.join(', ')}\n`;
        }
        if (prod.affiliate_recommended_approach) {
          prodContext += `Recommended Approach: ${prod.affiliate_recommended_approach}\n`;
        }
        
        contextParts.push(prodContext);
      }
    }

    if (audience_id) {
      const { data: icp } = await supabase
        .from('library_icps')
        .select('name, summary, description, pain_points, desires, objections, language_style')
        .eq('id', audience_id)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (icp) {
        let icpContext = `Audience: ${icp.name}\n`;
        const about = icp.summary || icp.description;
        if (about) icpContext += `${about}\n`;
        if (icp.pain_points?.length) icpContext += `Their pains:\n${icp.pain_points.map((p: string) => `- ${p}`).join('\n')}\n`;
        if (icp.desires?.length) icpContext += `What they want:\n${icp.desires.map((d: string) => `- ${d}`).join('\n')}\n`;
        if (icp.objections?.length) icpContext += `Their objections:\n${icp.objections.map((o: string) => `- ${o}`).join('\n')}\n`;
        if (icp.language_style) icpContext += `How they talk: ${icp.language_style}\n`;
        contextParts.push(icpContext);
      }
    }

    if (content_angle_id) {
      const { data: angle } = await supabase
        .from('library_content_angles')
        .select('name, angle_type, subject, opening_hook, main_content, closing_cta, target_audience, emotional_triggers, pain_points_addressed, desires_targeted')
        .eq('id', content_angle_id)
        .single();
      
      if (angle) {
        let angleContext = `Content Angle: ${angle.name}\n`;
        if (angle.angle_type) angleContext += `Type: ${angle.angle_type}\n`;
        if (angle.subject) angleContext += `Subject: ${angle.subject}\n`;
        if (angle.target_audience) angleContext += `Target Audience: ${angle.target_audience}\n`;
        if (angle.opening_hook) angleContext += `Opening Hook: ${angle.opening_hook}\n`;
        if (angle.main_content) angleContext += `Main Content Structure: ${angle.main_content}\n`;
        if (angle.closing_cta) angleContext += `Closing CTA: ${angle.closing_cta}\n`;
        if (angle.emotional_triggers && angle.emotional_triggers.length > 0) angleContext += `Emotional Triggers: ${angle.emotional_triggers.join(', ')}\n`;
        if (angle.pain_points_addressed && angle.pain_points_addressed.length > 0) angleContext += `Pain Points: ${angle.pain_points_addressed.join(', ')}\n`;
        if (angle.desires_targeted && angle.desires_targeted.length > 0) angleContext += `Desires Targeted: ${angle.desires_targeted.join(', ')}\n`;
        contextParts.push(angleContext);
      }
    }

    // Get OpenRouter API key
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKeyData && !(await hasOllamaKey(supabase, orgId))) {
      return new Response(
        JSON.stringify({ 
          error: 'OpenRouter API key not configured. Please add it in Settings > API Keys.' 
        }), 
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Decrypt the API key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      return new Response(
        JSON.stringify({ error: 'Encryption key not configured' }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const decryptedApiKey = apiKeyData ? await decryptApiKey(apiKeyData.key_encrypted, encryptionKey) : undefined;
    if (decryptedApiKey) console.log('✓ API key decrypted successfully');

    // Retrieve knowledge base context if document IDs are provided
    if (knowledge_document_ids && knowledge_document_ids.length > 0 && decryptedApiKey) {
      try {
        const kbQuery = `${title} ${contextParts.slice(1).map(p => p.split('\n')[0]).join(' ')}`.trim();
        console.log('[KB RAG] Retrieving chunks for query:', kbQuery.substring(0, 200));
        const kbResult = await retrieveChunksByDocIds(supabase, orgId, knowledge_document_ids, kbQuery, decryptedApiKey, 5);
        if (kbResult.chunks.length > 0) {
          const kbContext = kbResult.chunks.map((chunk, i) => `[${i + 1}] ${chunk.content}`).join('\n\n---\n\n');
          contextParts.push(`**KNOWLEDGE BASE — HOOK TEMPLATES & WRITING PATTERNS**:\nBelow are proven hook templates, frameworks, and writing patterns from the user's swipe file. You MUST use these as direct templates for generating hooks — take the exact structural pattern (e.g. "I just [action] and here is what I learned", "Your [thing] is broken. Here is proof.", "[Number]% of [audience] fail at [thing]") and fill in the blanks with the specific idea topic above. Match the tone, rhythm, cadence, and psychological triggers of these examples. The hooks you generate should feel like they came from this same swipe file, applied to the idea topic:\n\n${kbContext}`);
          console.log(`[KB RAG] Retrieved ${kbResult.chunks.length} chunks, ${kbResult.tokenUsage} tokens used`);
        } else {
          console.log('[KB RAG] No relevant chunks found');
        }
      } catch (kbError) {
        console.warn('[KB RAG] Knowledge base retrieval failed (non-fatal):', kbError);
      }
    }

    // Get default model
    const { data: settings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', orgId)
      .single();

    const model = settings?.default_llm_model || 'meta-llama/llama-3.3-70b-instruct';
    console.log('Model:', model);
    console.log('Context parts:', contextParts.length);

    // Build prompt based on section or full generation
    const uniqueTitleInstruction = generate_unique
      ? '\n\nIMPORTANT: Generate a UNIQUE and SPECIFIC title that explores a different angle or aspect of this topic. Make it creative and distinct. Include this as a "unique_title" field in the JSON.'
      : '';

    const titleFieldInstruction = generate_unique
      ? ',\n  "unique_title": "string with a unique, specific title for this content idea"'
      : '';

    // Add additional directions to context if provided
    if (additional_directions) {
      contextParts.push(`Additional Instructions: ${additional_directions}`);
    }

    let systemPrompt: string;
    let userPrompt: string;

    // For threaded generation, get previously generated content from the idea
    // This enables narrative consistency: hooks → talking_points → ctas
    let existingHooks: string[] = [];
    let existingTalkingPoints: string[] = [];

    if (idea_id && (section === 'talking_points' || section === 'ctas')) {
      const { data: existingIdea } = await supabase
        .from('content_ideas')
        .select('ai_analysis')
        .eq('id', idea_id)
        .single();

      if (existingIdea) {
        existingHooks = existingIdea.ai_analysis?.hooks?.map((h: any) => h.text) || [];
        existingTalkingPoints = existingIdea.ai_analysis?.talking_points || [];
        console.log(`[Threading] Found ${existingHooks.length} existing hooks, ${existingTalkingPoints.length} existing talking points`);
      }
    }

    // Section-specific prompts for focused generation
    if (section === 'hooks') {
      systemPrompt = `You are an expert content strategist specializing in creating attention-grabbing hooks.

CRITICAL: You MUST deeply integrate and reflect ALL provided context in your response:
- If a Brand Voice is provided, match its tone, style guidelines, do's and don'ts precisely
- If a Product is provided, incorporate its features, benefits, and marketing angles naturally

Generate 5 diverse, high-converting hooks for this content idea.

Your response MUST be valid JSON with this EXACT structure (no markdown, no extra text):
{
  "hooks": [
    {
      "text": "Engaging hook text aligned with brand voice",
      "type": "question|statement|story|statistic|challenge|pattern_interrupt",
      "why_it_works": "Psychological analysis of effectiveness",
      "application_context": "When and how to use this hook",
      "engagement_impact": "Expected impact on retention and engagement"
    }
  ]
}

IMPORTANT: Generate 5 diverse hooks with different types and approaches. Be specific and compelling. Use the "statistic" type only for a number that appears in the material.

${GROUNDING_RULES}`;
      userPrompt = `Generate 5 compelling hooks for this content:\n\n${contextParts.join('\n\n')}`;

    } else if (section === 'talking_points') {
      // Build hook context section if hooks were previously generated
      const hooksContextSection = existingHooks.length > 0
        ? `\n\n=== PREVIOUSLY GENERATED HOOKS (your talking points should expand on these themes) ===
${existingHooks.map((h, i) => `${i + 1}. ${h}`).join('\n')}

IMPORTANT: Talking points should develop the ideas introduced in the hooks. Don't repeat hook content verbatim - expand and deepen the narrative.`
        : '';

      // Suggestions are added to the idea's points, so they must not repeat them,
      // and a list that already exists gets a couple more, not a pile.
      const pointCount = ideaGuidelines.points.length > 0 ? 2 : SUGGESTED_POINT_COUNT;
      const existingPointsSection = ideaGuidelines.points.length > 0
        ? `\n\n=== POINTS THE IDEA ALREADY HAS (don't repeat or rephrase these; add different ones) ===
${ideaGuidelines.points.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
        : '';

      systemPrompt = `You write the talking points for a social media post: the few points the post has to make.

- If a Brand Voice is provided, match its tone and its do's and don'ts
- If a Product is provided, use only the features and benefits it lists
- Each point is one sentence, plain and specific, that a writer can turn into a paragraph${hooksContextSection}${existingPointsSection}

Generate ${pointCount} talking points for this content idea.

${GROUNDING_RULES}

Your response MUST be valid JSON with this EXACT structure (no markdown, no extra text):
{
  "talking_points": ["point 1", "point 2", "point 3", "point 4"]
}`;
      userPrompt = `Generate ${pointCount} talking points for this content:\n\n${contextParts.join('\n\n')}`;

    } else if (section === 'ctas') {
      // Build context sections for narrative threading
      const hooksContextSection = existingHooks.length > 0
        ? `\n\n=== HOOKS USED (CTAs should align with the emotional hooks) ===
${existingHooks.map((h, i) => `${i + 1}. ${h}`).join('\n')}`
        : '';

      const talkingPointsContextSection = existingTalkingPoints.length > 0
        ? `\n\n=== TALKING POINTS (CTAs should feel like natural conclusions to these) ===
${existingTalkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

IMPORTANT: CTAs should feel like the natural next step after the talking points. Match the narrative arc established by hooks and talking points.`
        : '';

      systemPrompt = `You are an expert content strategist specializing in creating effective calls-to-action.

CRITICAL: You MUST deeply integrate and reflect ALL provided context in your response:
- If a Brand Voice is provided, match its tone, style guidelines, do's and don'ts precisely
- If a Product is provided, incorporate its unique value propositions and benefits${hooksContextSection}${talkingPointsContextSection}

Generate 5 strategic CTAs (Call-to-Actions) for this content idea.

Your response MUST be valid JSON with this EXACT structure (no markdown, no extra text):
{
  "ctas": [
    {
      "text": "Compelling CTA text",
      "placement": "opening|middle|end",
      "type": "subscribe|like|comment|share|link|buy|question",
      "effectiveness": "Strategy for maximum conversion",
      "psychological_trigger": "What motivates action"
    }
  ]
}

IMPORTANT: Generate 5 diverse CTAs with different placements and types. Be persuasive and action-oriented.

${GROUNDING_RULES}`;
      userPrompt = `Generate 5 compelling CTAs for this content:\n\n${contextParts.join('\n\n')}`;

    } else {
      // Full generation (original behavior)
      systemPrompt = `You are an expert content strategist creating comprehensive content blueprints.${uniqueTitleInstruction}

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
   - Platform-specific optimization tips

Your response MUST be valid JSON with this EXACT structure (no markdown, no extra text):
{
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6"],
  "emotional_triggers": ["trigger1", "trigger2", "trigger3", "trigger4"],
  "content_framework": "Comprehensive framework: [Hook Type] → [Body Structure] → [Climax Strategy] → [CTA Approach]. Full content architecture explained.",
  "ai_analysis": {
    "talking_points": [
      "One-sentence point the post has to make",
      "One-sentence point the post has to make",
      "One-sentence point the post has to make",
      "One-sentence point the post has to make"
    ],
    "hooks": [
      {
        "text": "Engaging hook text aligned with brand voice",
        "type": "question|statement|story|statistic|challenge|pattern_interrupt",
        "why_it_works": "Psychological analysis of effectiveness",
        "application_context": "When and how to use this hook",
        "engagement_impact": "Expected impact on retention and engagement"
      }
    ],
    "ctas": [
      {
        "text": "Compelling CTA text",
        "placement": "opening|middle|end",
        "type": "subscribe|like|comment|share|link|buy|question",
        "effectiveness": "Strategy for maximum conversion",
        "psychological_trigger": "What motivates action"
      }
    ],
    "script_structure": {
      "opening": "Detailed opening strategy with hook deployment aligned with content angle",
      "body": "Content flow, transitions, retention tactics, and key messaging points",
      "climax": "Peak moment or key insight delivery that drives value",
      "closing": "Wrap-up strategy and final CTA placement"
    },
    "engagement_drivers": [
      "Specific driver 1: Detailed explanation of how it engages audience",
      "Specific driver 2: Detailed explanation of how it engages audience",
      "Specific driver 3: Detailed explanation of how it engages audience"
    ],
    "viral_elements": [
      "Unique angle or perspective that makes it shareable",
      "Controversial or surprising element that sparks discussion",
      "Emotional peak moments that resonate deeply",
      "Quotable or memorable moments worth sharing"
    ],
    "content_patterns": [
      "Pattern 1: e.g., Question → Story → Lesson → CTA",
      "Pattern 2: e.g., Bold claim → Evidence → Application",
      "Pattern 3: e.g., Problem → Agitation → Solution"
    ],
    "target_audience": "Detailed description of ideal audience aligned with ICP/product data",
    "viral_potential": "Assessment of viral potential with specific factors and strategies",
    "insights": "Key insights about content opportunity referencing brand voice, product features, and angle",
    "adaptation_strategy": "How to adapt this blueprint for different platforms while maintaining effectiveness",
    "platform_optimization": "Platform-specific tips for this content type and style",
    "audience_insights": "What this reveals about target audience's desires, fears, and preferences",
    "repurposing_ideas": [
      "Specific repurposing idea 1 with platform",
      "Specific repurposing idea 2 with platform",
      "Specific repurposing idea 3 with platform",
      "Specific repurposing idea 4 with platform"
    ]
  }${titleFieldInstruction}
}

IMPORTANT: Generate COMPREHENSIVE, actionable content with ALL fields filled. Be specific and deeply integrate provided context. Write exactly ${SUGGESTED_POINT_COUNT} talking points.

${GROUNDING_RULES}`;
      userPrompt = `Generate a content idea based on:\n\n${contextParts.join('\n\n')}`;
    }

    // Call OpenRouter with streaming
    console.log('Calling OpenRouter API...');
    const openRouterResponse = await fetchChatCompletions({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: true,
      temperature: 0.7,
      max_tokens: 8000,
    }, {
      openRouterApiKey: decryptedApiKey,
      supabase,
      organizationId: orgId,
      referer: supabaseUrl,
    });

    console.log('OpenRouter response status:', openRouterResponse.status);
    console.log('OpenRouter ok:', openRouterResponse.ok);

    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text();
      console.error('OpenRouter error:', errorText);
      return new Response(
        JSON.stringify({ 
          error: `OpenRouter API error: ${openRouterResponse.status}. Please check your API key.` 
        }), 
        { 
          status: openRouterResponse.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Create SSE stream back to client
    const stream = new ReadableStream({
      async start(controller) {
        const reader = openRouterResponse.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content || '';
                  if (content) {
                    fullContent += content;
                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'progress', content })}\n\n`));
                  }
                } catch (e) {
                  console.error('Parse error:', e);
                }
              }
            }
          }

          console.log('=== Full AI Content ===');
          console.log('Content length:', fullContent.length);
          console.log('First 500 chars:', fullContent.substring(0, 500));
          console.log('Last 500 chars:', fullContent.substring(Math.max(0, fullContent.length - 500)));

          // Parse complete JSON response with improved extraction
          console.log('=== JSON Extraction ===');
          let result;

          // First, strip markdown code blocks if present
          let cleanContent = fullContent.trim();
          const codeBlockPattern = /```(?:json)?\s*([\s\S]*?)\s*```/;
          const codeBlockMatch = cleanContent.match(codeBlockPattern);
          if (codeBlockMatch) {
            console.log('Removing markdown code block wrapper');
            cleanContent = codeBlockMatch[1].trim();
          }

          // Find the first complete JSON object using brace counting
          const firstBrace = cleanContent.indexOf('{');
          if (firstBrace === -1) throw new Error('No JSON object found in response');
          
          console.log('First brace at position:', firstBrace);
          
          // Count braces to find matching closing brace
          let braceCount = 0;
          let endIndex = -1;
          let inString = false;
          let escapeNext = false;
          
          for (let i = firstBrace; i < cleanContent.length; i++) {
            const char = cleanContent[i];
            
            // Handle string escaping
            if (escapeNext) {
              escapeNext = false;
              continue;
            }
            
            if (char === '\\') {
              escapeNext = true;
              continue;
            }
            
            // Track if we're inside a string (strings can contain braces)
            if (char === '"') {
              inString = !inString;
              continue;
            }
            
            // Only count braces outside of strings
            if (!inString) {
              if (char === '{') braceCount++;
              if (char === '}') {
                braceCount--;
                if (braceCount === 0) {
                  endIndex = i + 1;
                  break;
                }
              }
            }
          }
          
          if (endIndex === -1) throw new Error('No complete JSON object found');
          
          const jsonStr = cleanContent.substring(firstBrace, endIndex);
          console.log('Extracted JSON length:', jsonStr.length);
          console.log('Extracted JSON preview:', jsonStr.substring(0, 200));
          result = JSON.parse(jsonStr);

          console.log('=== Parsed Result ===');
          console.log('Result keys:', Object.keys(result));
          console.log('Section:', section);
          console.log('Full result object:', JSON.stringify(result, null, 2));

          // Validate based on section type
          if (section === 'hooks') {
            if (!result.hooks) throw new Error('AI response missing hooks');
          } else if (section === 'talking_points') {
            if (!result.talking_points) throw new Error('AI response missing talking points');
          } else if (section === 'ctas') {
            if (!result.ctas) throw new Error('AI response missing CTAs');
          } else {
            // Full generation validation
            if (!result.ai_analysis || !result.keywords) {
              throw new Error('AI response missing required fields');
            }
          }

          // Update database with generated content
          console.log('=== Database Update Starting ===');
          console.log('Updating idea:', idea_id);

          // Fetch existing data for merging (for section-specific updates)
          const { data: existingIdea } = await supabase
            .from('content_ideas')
            .select('ai_analysis, metadata')
            .eq('id', idea_id)
            .single();

          const existingAiAnalysis = existingIdea?.ai_analysis || {};
          const existingMetadata = existingIdea?.metadata || {};

          let updatePayload: any;

          if (section === 'hooks') {
            // Only update hooks in ai_analysis
            const updatedAiAnalysis = {
              ...existingAiAnalysis,
              hooks: result.hooks,
            };
            updatePayload = {
              ai_analysis: updatedAiAnalysis,
              generation_in_progress: false,
              metadata: {
                ...existingMetadata,
                hooks: result.hooks,
                hooks_generated_at: new Date().toISOString(),
                hooks_model_used: model,
              },
            };
          } else if (section === 'talking_points') {
            // Suggestions are added after the idea's points and marked as AI
            // drafts; nothing the idea already has is replaced.
            const suggested = cleanList(result.talking_points);
            const currentPoints = cleanList(existingAiAnalysis.talking_points);
            const updatedAiAnalysis = {
              ...existingAiAnalysis,
              talking_points: appendPoints(currentPoints, suggested),
              talking_points_ai: appendPoints(draftPoints(existingAiAnalysis, currentPoints), suggested),
            };
            updatePayload = {
              ai_analysis: updatedAiAnalysis,
              generation_in_progress: false,
              metadata: {
                ...existingMetadata,
                talking_points_generated_at: new Date().toISOString(),
                talking_points_model_used: model,
              },
            };
          } else if (section === 'ctas') {
            // Only update CTAs in ai_analysis
            const updatedAiAnalysis = {
              ...existingAiAnalysis,
              ctas: result.ctas,
            };
            updatePayload = {
              ai_analysis: updatedAiAnalysis,
              generation_in_progress: false,
              metadata: {
                ...existingMetadata,
                ctas: result.ctas,
                ctas_generated_at: new Date().toISOString(),
                ctas_model_used: model,
              },
            };
          } else {
            // Full generation: new hooks, CTAs and analysis. The idea's
            // guidelines stay: existing points and the avoid list are kept, and
            // new points only fill an idea that had none (as AI drafts).
            // Metadata is merged so the source link (Trending, Signals) survives.
            const currentPoints = cleanList(existingAiAnalysis.talking_points);
            const newAnalysis: Record<string, any> = { ...(result.ai_analysis || {}) };
            if (currentPoints.length > 0) {
              newAnalysis.talking_points = currentPoints;
              newAnalysis.talking_points_ai = draftPoints(existingAiAnalysis, currentPoints);
            } else {
              const suggested = cleanList(newAnalysis.talking_points).slice(0, SUGGESTED_POINT_COUNT);
              newAnalysis.talking_points = suggested;
              newAnalysis.talking_points_ai = suggested;
            }
            if (existingAiAnalysis.avoid !== undefined) newAnalysis.avoid = existingAiAnalysis.avoid;
            updatePayload = {
              ai_analysis: newAnalysis,
              emotional_triggers: result.emotional_triggers,
              content_framework: result.content_framework,
              keywords: result.keywords,
              generation_in_progress: false,
              metadata: {
                ...existingMetadata,
                hooks: result.ai_analysis?.hooks || [],
                ctas: result.ai_analysis?.ctas || [],
                generated_at: new Date().toISOString(),
                model_used: model,
              },
            };

            // Add unique title if generated
            if (result.unique_title) {
              updatePayload.title = result.unique_title;
              console.log('Setting unique title:', result.unique_title);
            }
          }

          console.log('Update payload:', updatePayload);

          const { data: updateData, error: updateError } = await supabase
            .from('content_ideas')
            .update(updatePayload)
            .eq('id', idea_id)
            .select();

          if (updateError) {
            console.error('Database update error:', updateError);
            throw new Error(`Database update failed: ${updateError.message}`);
          }

          console.log('=== Database Update Complete ===');
          console.log('✓ Updated idea:', idea_id);
          console.log('Updated data:', updateData);

          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`));
          controller.close();

        } catch (error) {
          console.error('Stream error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          // Clear generation flag on error
          await supabase
            .from('content_ideas')
            .update({ generation_in_progress: false })
            .eq('id', idea_id);
          
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`));
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
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const status = error instanceof Error && error.message.includes('Unauthorized') ? 401 : 500;
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
