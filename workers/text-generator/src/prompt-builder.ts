import { ChatMessage } from './openrouter.js';

export interface GenerateRequest {
  output_id: string;
  stage_id: string;
  pipeline_id: string;
  prompt: string;
  custom_prompt?: string;
  instructions?: string;
  current_content?: string;
  talking_points?: string[];
  outline_sections?: Array<{ heading: string; key_points?: string[] }>;
  model_config: { model: string; temperature?: number; max_tokens?: number };
  brand_voice?: { tone?: string; style?: string; style_guidelines?: string; guidelines?: string };
  video_duration_seconds?: number;
  library_elements?: Record<string, any>;
  idea_context?: string;
  autopilot_id?: string;
  auto_approve_all?: boolean;
  api_key: string;
  supabase_url: string;
  supabase_key: string;
}

// Date variables resolved at generation time
function getDateVariables(): Record<string, string> {
  const now = new Date();
  return {
    current_year: String(now.getFullYear()),
    current_month: now.toLocaleString('en-US', { month: 'long' }),
    current_month_short: now.toLocaleString('en-US', { month: 'short' }),
    current_month_number: String(now.getMonth() + 1).padStart(2, '0'),
    current_date: now.toISOString().split('T')[0],
    current_quarter: `Q${Math.ceil((now.getMonth() + 1) / 3)}`,
  };
}

export function resolveDateVariables(text: string): string {
  const vars = getDateVariables();
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
    text = text.replace(regex, value);
  }
  return text;
}

function getBrandVoice(libraryElements: Record<string, any>): any {
  const bvData = libraryElements.library_brand_voices || libraryElements.brand || libraryElements.brand_voice;
  if (!bvData) return null;
  return Array.isArray(bvData) ? bvData[0] : bvData;
}

function buildStoryContext(libraryElements: Record<string, any>, ideaContext?: string): string {
  let context = '';

  if (ideaContext) {
    context += `\n=== MAIN TOPIC (CHARACTER MUST DISCUSS THIS) ===\n`;
    context += `${ideaContext}\n`;
  }

  if (libraryElements.product) {
    const prod = Array.isArray(libraryElements.product)
      ? libraryElements.product[0] : libraryElements.product;
    if (prod) {
      context += `\n=== PRODUCT TO DISCUSS ===\n`;
      context += `Product: ${prod.name}\n`;
      if (prod.key_benefits?.length) {
        context += `Key Benefits to Highlight: ${prod.key_benefits.join(', ')}\n`;
      }
      if (prod.features?.length) {
        context += `Features to Explain: ${prod.features.slice(0, 5).join(', ')}\n`;
      }
    }
  }

  const bvTone = getBrandVoice(libraryElements);
  if (bvTone) {
    context += `\n=== SPEAKING STYLE ===\n`;
    if (bvTone.tone) context += `Tone: ${bvTone.tone}\n`;
    if (bvTone.style_guidelines) context += `Style: ${bvTone.style_guidelines}\n`;
  }

  if (libraryElements.icp) {
    const icp = Array.isArray(libraryElements.icp)
      ? libraryElements.icp[0] : libraryElements.icp;
    if (icp) {
      context += `\n=== AUDIENCE RESONANCE ===\n`;
      if (icp.pain_points?.length) {
        context += `Pain Points to Address: ${icp.pain_points.slice(0, 3).join(', ')}\n`;
      }
      if (icp.desires?.length) {
        context += `Desires to Fulfill: ${icp.desires.slice(0, 3).join(', ')}\n`;
      }
      if (icp.language_style) {
        context += `Speak in: ${icp.language_style}\n`;
      }
    }
  }

  return context;
}

// System message enforcing clean text output
const CLEAN_OUTPUT_SYSTEM: ChatMessage = {
  role: 'system',
  content: `You are generating content that will be used directly without editing.

CRITICAL OUTPUT RULES:
- Output ONLY the requested content itself - nothing else
- Do NOT use any markdown formatting (no **, __, #, >, \`, etc.)
- Do NOT include headers, titles, or labels like "Here's your content:" or "Output:"
- Do NOT add explanatory notes, tips, or meta-commentary
- Do NOT wrap the output in quotes
- The output must be ready to use immediately as-is

Start your response with the actual content immediately.`,
};

export interface PromptPlan {
  type: 'single' | 'multi_section';
  messages?: ChatMessage[];            // for single
  sections?: SectionPlan[];            // for multi_section
  systemPrompt?: string;               // override system prompt for sections
}

export interface SectionPlan {
  name: string;
  messages: ChatMessage[];
}

export function buildPromptPlan(req: GenerateRequest): PromptPlan {
  let prompt = req.custom_prompt || req.prompt || 'Generate content based on the provided context.';
  prompt = resolveDateVariables(prompt);

  const talkingPoints = req.talking_points || [];
  const outlineSections = req.outline_sections || [];
  const libraryElements = req.library_elements || {};
  const brandVoice = req.brand_voice || getBrandVoice(libraryElements);

  // --- REGENERATION WITH INSTRUCTIONS ---
  if (req.instructions && req.instructions.trim() && !req.custom_prompt) {
    const existingContent = req.current_content || '';
    prompt = `You are regenerating content based on user feedback.

ORIGINAL PROMPT/CONTEXT:
${req.prompt || ''}

CURRENT CONTENT TO MODIFY:
${existingContent}

USER INSTRUCTIONS FOR CHANGES:
${req.instructions}

Please regenerate the content following the user's instructions while maintaining the overall context, tone, and purpose. Output only the regenerated content without any additional commentary or explanation.`;
  }

  // --- LONG ARTICLE DETECTION ---
  // article stage with 6+ outline sections or 5+ talking points
  const isArticleStage = req.stage_id === 'article' && outlineSections.length > 0;
  const needsArticleSections = isArticleStage &&
    (outlineSections.length >= 6 || talkingPoints.length >= 5);

  if (needsArticleSections) {
    return buildArticleSectionPlan(prompt, outlineSections, talkingPoints, brandVoice, libraryElements);
  }

  // --- LONG VIDEO SCRIPT (UGC) ---
  // Only ugc_video's 'script' stage benefits from per-section generation
  const isVideoScript = req.stage_id === 'script';
  const needsScriptSections = isVideoScript && talkingPoints.length >= 5;

  if (needsScriptSections) {
    return buildScriptSectionPlan(prompt, talkingPoints, brandVoice, libraryElements, req.idea_context);
  }

  // --- STANDARD SINGLE-CALL GENERATION ---
  if (talkingPoints.length > 0) {
    const section = `\n\n## KEY TALKING POINTS TO INCORPORATE\nMake sure your content addresses these key points:\n${talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n`;
    prompt = prompt + section;
  }

  // Duration constraint for outline stages
  if (req.stage_id === 'outline' && req.video_duration_seconds) {
    const dur = req.video_duration_seconds;
    const targetWords = Math.round(dur * 2.5);
    prompt += `\n\n## VIDEO DURATION CONSTRAINT (STRICT)
This narration will be converted to voiceover for a ${dur} second video.
STRICTLY limit your narration to ${targetWords} words MAXIMUM. DO NOT exceed ${targetWords} words under any circumstances.
Count your words carefully. The voiceover must fit within ${dur} seconds at ~2.5 words/second.
${dur <= 30 ? 'This is a SHORT video. Be concise and punchy - every word must earn its place.' : ''}
${dur >= 120 ? 'You have time to develop the narrative fully.' : ''}`;
  }

  const messages: ChatMessage[] = [
    CLEAN_OUTPUT_SYSTEM,
    { role: 'user', content: prompt },
  ];

  return { type: 'single', messages };
}

function buildArticleSectionPlan(
  masterPrompt: string,
  sections: Array<{ heading: string; key_points?: string[] }>,
  talkingPoints: string[],
  brandVoice: any,
  libraryElements: Record<string, any>,
): PromptPlan {
  const contentSections = sections.filter((s) =>
    !s.heading?.toLowerCase().includes('introduction') &&
    !s.heading?.toLowerCase().includes('conclusion')
  );

  const getTalkingPointsForSection = (sectionIndex: number): string[] => {
    if (talkingPoints.length === 0) return [];
    const idx = sectionIndex % talkingPoints.length;
    return [
      talkingPoints[idx],
      talkingPoints[(idx + 1) % talkingPoints.length],
    ].filter((p, i, arr) => arr.indexOf(p) === i);
  };

  let systemPrompt = 'You are writing a section of a long-form article.';
  if (brandVoice?.tone) systemPrompt += `\n\nTone: ${brandVoice.tone}`;
  if (brandVoice?.style_guidelines) systemPrompt += `\nStyle: ${brandVoice.style_guidelines}`;

  const sectionPlans: SectionPlan[] = sections.map((section, i) => {
    const isIntro = section.heading?.toLowerCase().includes('introduction');
    const isConclusion = section.heading?.toLowerCase().includes('conclusion');

    let sectionTPs: string[] = [];
    if (!isIntro && !isConclusion) {
      const contentIdx = contentSections.findIndex((s) => s.heading === section.heading);
      if (contentIdx >= 0) sectionTPs = getTalkingPointsForSection(contentIdx);
    }

    // Placeholder for previous content — will be injected at runtime
    const sectionPrompt = `Write the "${section.heading}" section of the article.

SECTION DETAILS:
- Heading: ${section.heading}
- Key points from outline: ${(section.key_points || []).join(', ')}
${sectionTPs.length > 0 ? `- Talking points to incorporate: ${sectionTPs.join('; ')}` : ''}

ARTICLE CONTEXT:
- This is section ${i + 1} of ${sections.length}
${isIntro ? '- This is the INTRODUCTION' : ''}
${isConclusion ? '- This is the CONCLUSION' : ''}
{{PREVIOUS_CONTENT}}

CONTINUITY REQUIREMENTS:
- Read the existing content above before writing
- DO NOT repeat arguments, examples, or statistics already made
- Continue the established tone and style

Use ## for the section heading. Output ONLY the section content.`;

    return {
      name: section.heading,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: sectionPrompt },
      ],
    };
  });

  return { type: 'multi_section', sections: sectionPlans, systemPrompt };
}

function buildScriptSectionPlan(
  masterPrompt: string,
  talkingPoints: string[],
  brandVoice: any,
  libraryElements: Record<string, any>,
  ideaContext?: string,
): PromptPlan {
  const parts: Array<{ type: string; name: string; talkingPoint?: string }> = [
    { type: 'intro', name: 'Hook & Introduction' },
    ...talkingPoints.map((tp, i) => ({ type: 'body', name: `Section ${i + 1}`, talkingPoint: tp })),
    { type: 'conclusion', name: 'Conclusion & CTA' },
  ];

  const storyContext = buildStoryContext(libraryElements, ideaContext);

  let systemPrompt = 'You are writing a section of a video script.';
  if (brandVoice?.tone) systemPrompt += `\n\nTONE: ${brandVoice.tone}`;
  if (brandVoice?.style_guidelines) systemPrompt += `\nSTYLE: ${brandVoice.style_guidelines}`;

  const sectionPlans: SectionPlan[] = parts.map((section, i) => {
    const isIntro = section.type === 'intro';
    const isConclusion = section.type === 'conclusion';

    const sectionPrompt = `Write the "${section.name}" section of this video script.

SECTION DETAILS:
- Section: ${section.name} (${i + 1} of ${parts.length})
${section.talkingPoint ? `- Key talking point to cover: ${section.talkingPoint}` : ''}
${isIntro ? '- This is the INTRODUCTION' : ''}
${isConclusion ? '- This is the CONCLUSION' : ''}

STORY CONTEXT:
${storyContext}

ORIGINAL BRIEF:
${masterPrompt}
{{PREVIOUS_CONTENT}}

CONTINUITY REQUIREMENTS:
- Read the existing script above CAREFULLY before writing
- DO NOT repeat arguments, examples, statistics, or phrases already used
- Each section must advance the narrative with NEW information
- Continue the tone and style established in previous sections

Output ONLY the section content, ready to be spoken. No formatting markers or section headers.`;

    return {
      name: section.name,
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: sectionPrompt },
      ],
    };
  });

  return { type: 'multi_section', sections: sectionPlans, systemPrompt };
}

// Inject previous content into section prompt at runtime
export function injectPreviousContent(prompt: string, previousContent: string): string {
  const MAX_CHARS = 100_000;

  if (!previousContent || previousContent.length === 0) {
    return prompt.replace('{{PREVIOUS_CONTENT}}', '');
  }

  let contextBlock: string;
  if (previousContent.length <= MAX_CHARS) {
    contextBlock = `\n\n=== CONTENT SO FAR (read this carefully before continuing) ===\n${previousContent}\n=== END OF EXISTING CONTENT ===`;
  } else {
    const recent = previousContent.slice(-50_000);
    contextBlock = `\n\n=== CONTENT SO FAR ===
[Earlier sections established the foundation]

RECENT CONTENT (read carefully):
...${recent}
=== END OF EXISTING CONTENT ===`;
  }

  return prompt.replace('{{PREVIOUS_CONTENT}}', contextBlock);
}
