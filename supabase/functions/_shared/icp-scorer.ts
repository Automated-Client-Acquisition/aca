/**
 * ICP Scorer Utility
 *
 * Scores a lead magnet commenter against an ICP definition using a fast LLM.
 * Used inline during comment polling to decide whether to qualify a lead.
 */

import { sanitizeAIOutput } from './sanitize-ai-output.ts';
import { DEFAULT_SCORER_MODEL, DEFAULT_QUALITY_TEXT_MODEL } from './default-models.ts';
import { fetchChatCompletions, type LlmFetchOptions } from './llm-client.ts';

export interface ICPDefinition {
  name: string;
  summary: string | null;
  description: string | null;
  pain_points: string[] | null;
  desires: string[] | null;
  objections: string[] | null;
  language_style: string | null;
  tags: string[] | null;
  target_locations?: string[] | null;
}

export interface ScoreLeadInput {
  commenterName: string;
  commenterHeadline: string | null;
  commentText: string;
  commenterProfileUrl: string | null;
  icpDefinition: ICPDefinition;
}

export interface ScoreLeadOutput {
  score: number;
  reasoning: string;
  matchedTraits: string[];
}

const SCORER_MODEL = DEFAULT_SCORER_MODEL;
const SCORER_TIMEOUT_MS = 15_000;

/**
 * Score a commenter against an ICP definition using a fast LLM.
 * Returns a score 0-100 with reasoning.
 */
export async function scoreLead(
  input: ScoreLeadInput,
  openRouterApiKey: string,
  referer?: string,
): Promise<ScoreLeadOutput> {
  const { commenterName, commenterHeadline, commentText, icpDefinition } = input;

  const systemPrompt = `You are an ICP (Ideal Customer Profile) scoring assistant.
You will receive an ICP definition and information about a social media commenter.
Score how well this person matches the target ICP on a scale of 0-100.

Scoring guidelines:
- 80-100: Strong match — job title, industry, and intent align with ICP
- 60-79: Good match — some key indicators align
- 40-59: Moderate — limited info but not disqualifying
- 20-39: Weak match — signals suggest poor fit
- 0-19: No match — clearly outside target audience

The LinkedIn headline is the strongest signal. It typically contains job title, company, and industry.
The comment text indicates interest level and intent.
If headline is unavailable, rely on comment text and name for scoring.

IMPORTANT: Return ONLY valid JSON. No markdown, no code blocks.`;

  const summary = icpDefinition.summary
    ? `\n- Summary: ${icpDefinition.summary}`
    : '';
  const painPoints = icpDefinition.pain_points?.length
    ? `\n- Pain points: ${icpDefinition.pain_points.join(', ')}`
    : '';
  const desires = icpDefinition.desires?.length
    ? `\n- Desires/goals: ${icpDefinition.desires.join(', ')}`
    : '';
  const tags = icpDefinition.tags?.length
    ? `\n- Industry/tags: ${icpDefinition.tags.join(', ')}`
    : '';

  const userPrompt = `ICP Definition:
- Name: ${icpDefinition.name}${summary}${icpDefinition.description ? `\n- Description: ${icpDefinition.description}` : ''}${painPoints}${desires}${tags}

Commenter Information:
- Name: ${commenterName}
- LinkedIn Headline: ${commenterHeadline || 'Not available'}
- Comment text: "${commentText}"

Return JSON: { "score": <0-100>, "reasoning": "<1-2 sentences>", "matched_traits": ["<trait1>", ...] }`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCORER_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
        ...(referer ? { 'HTTP-Referer': referer } : {}),
      },
      body: JSON.stringify({
        model: SCORER_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from LLM');
    }

    // Strip markdown code fences that some OpenRouter models add despite response_format
    const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score ?? 50))),
      reasoning: sanitizeAIOutput(parsed.reasoning || 'No reasoning provided'),
      matchedTraits: Array.isArray(parsed.matched_traits) ? parsed.matched_traits.map((t: string) => sanitizeAIOutput(t)) : [],
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[ICP Scorer] Timeout after', SCORER_TIMEOUT_MS, 'ms');
      return { score: 50, reasoning: 'Scoring timed out, using default score', matchedTraits: [] };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// List Building Engine: per-dimension company + DM scoring.
//
// Spec: ACA_List_Building_Engine_Spec §7.2. Returns integer sub-scores bounded
// by the per-dimension max weights below. Callers sum them for icp_score and
// map to a fit_label.
// ---------------------------------------------------------------------------

export const LIST_BUILDING_SCORE_WEIGHTS = {
  industry: 25,
  size: 20,
  geo: 15,
  seniority: 20,
  type: 20,
} as const;

export interface CompanyForScoring {
  company_name: string;
  domain?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  employee_signal?: string | null;
  employee_count_estimate?: number | null;
  raw_html_snippet?: string | null;
}

export interface DmForScoring {
  first_name: string;
  last_name?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
}

export interface CompanyScoreBreakdown {
  industry: number;
  size: number;
  geo: number;
  seniority: number;
  type: number;
  reasoning: string;
}

const LB_FALLBACK: CompanyScoreBreakdown = {
  industry: 12,
  size: 10,
  geo: 7,
  seniority: 10,
  type: 10,
  reasoning: 'Scoring timed out',
};

function clampToWeight(raw: unknown, max: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

export async function scoreCompanyForListBuilding(
  input: {
    company: CompanyForScoring;
    dm: DmForScoring;
    icpDefinition: ICPDefinition;
  },
  openRouterApiKey: string,
  referer?: string,
): Promise<CompanyScoreBreakdown> {
  const { company, dm, icpDefinition } = input;

  const systemPrompt = `You are an ICP scoring assistant for B2B outbound list building.
Given an ICP definition and a (company, decision-maker) pair, score the fit on five independent dimensions.

Return ONLY valid JSON with exactly these keys and integer values, each bounded by its max:
{
  "industry":  0..25  (industry / niche match),
  "size":      0..20  (company size match),
  "geo":       0..15  (geography match),
  "seniority": 0..20  (decision-maker seniority),
  "type":      0..20  (business type match: B2B vs B2C, SaaS vs service, etc.),
  "reasoning": "<1-2 sentences explaining the total>"
}

Scoring guidance:
- Max score on a dimension means perfect alignment with the ICP on that dimension.
- Score 0 when the dimension clearly disqualifies the lead.
- When a dimension cannot be determined from the provided data, score ~50% of its max.
- Do NOT exceed the per-dimension max. No markdown, no code fences, no extra keys.`;

  const icpSummary = icpDefinition.summary ? `\n- Summary: ${icpDefinition.summary}` : '';
  const icpDesc = icpDefinition.description ? `\n- Description: ${icpDefinition.description}` : '';
  const icpTags = icpDefinition.tags?.length ? `\n- Industry/tags: ${icpDefinition.tags.join(', ')}` : '';
  const icpPain = icpDefinition.pain_points?.length ? `\n- Pain points: ${icpDefinition.pain_points.join(', ')}` : '';
  const icpGeo = icpDefinition.target_locations?.length ? `\n- Target locations: ${icpDefinition.target_locations.join(', ')}` : '';

  const geo = [company.city, company.state, company.country].filter(Boolean).join(', ') || 'Unknown';
  const sizeSignal = company.employee_count_estimate
    ? `${company.employee_count_estimate} employees`
    : (company.employee_signal || 'Unknown');
  const fullName = [dm.first_name, dm.last_name].filter(Boolean).join(' ').trim() || 'Unknown';
  const snippet = (company.raw_html_snippet || '').slice(0, 400);

  const userPrompt = `ICP Definition:
- Name: ${icpDefinition.name}${icpSummary}${icpDesc}${icpTags}${icpPain}${icpGeo}

Company:
- Name: ${company.company_name}
- Domain: ${company.domain || 'Unknown'}
- Website: ${company.website_url || 'Unknown'}
- LinkedIn: ${company.linkedin_url || 'Unknown'}
- Location: ${geo}
- Size: ${sizeSignal}
- Snippet: ${snippet || 'Not available'}

Decision Maker:
- Name: ${fullName}
- Title: ${dm.title || 'Unknown'}
- LinkedIn: ${dm.linkedin_url || 'Unknown'}

Return the JSON object now.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
        ...(referer ? { 'HTTP-Referer': referer } : {}),
      },
      body: JSON.stringify({
        model: SCORER_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(SCORER_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from LLM');

    const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      industry: clampToWeight(parsed.industry, LIST_BUILDING_SCORE_WEIGHTS.industry),
      size: clampToWeight(parsed.size, LIST_BUILDING_SCORE_WEIGHTS.size),
      geo: clampToWeight(parsed.geo, LIST_BUILDING_SCORE_WEIGHTS.geo),
      seniority: clampToWeight(parsed.seniority, LIST_BUILDING_SCORE_WEIGHTS.seniority),
      type: clampToWeight(parsed.type, LIST_BUILDING_SCORE_WEIGHTS.type),
      reasoning: sanitizeAIOutput(parsed.reasoning || 'No reasoning provided'),
    };
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      console.error('[ICP Scorer] list-building timeout after', SCORER_TIMEOUT_MS, 'ms');
      return { ...LB_FALLBACK };
    }
    console.error('[ICP Scorer] list-building scoring failed:', error);
    return { ...LB_FALLBACK, reasoning: `Scoring failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Generate the initial AI chatbot message for a qualifying lead.
 */
export async function generateInitialAiMessage(
  input: {
    commenterName: string;
    commenterHeadline: string | null;
    commentText: string;
    icpScore: number;
    icpReasoning: string;
    chatbotInstructions: string;
    brandVoice?: {
      tone: string | null;
      personality: string | null;
      writing_examples: string[] | null;
    } | null;
  },
  openRouterApiKey: string,
  model: string = DEFAULT_QUALITY_TEXT_MODEL,
  referer?: string,
  llmCtx?: Pick<LlmFetchOptions, 'supabase' | 'organizationId' | 'ollamaConfig'>,
): Promise<{ message: string; inputTokens: number; outputTokens: number }> {
  const brandVoiceSection = input.brandVoice
    ? `\nBRAND VOICE:
- Tone: ${input.brandVoice.tone || 'professional'}
- Personality: ${input.brandVoice.personality || 'helpful'}
${input.brandVoice.writing_examples?.length ? `- Examples of style: ${input.brandVoice.writing_examples.slice(0, 2).join('; ')}` : ''}`
    : '';

  const firstName = input.commenterName.split(' ')[0] || 'there';

  const systemPrompt = `You are a direct message ghostwriter. Write a LinkedIn DM opening message.

CONTEXT:
- ${input.commenterName} commented "${input.commentText}" on a social media post
- Their LinkedIn headline: ${input.commenterHeadline || 'Not available'}
- ICP match score: ${input.icpScore}/100 — ${input.icpReasoning}

YOUR ROLE:
${input.chatbotInstructions}
${brandVoiceSection}

YOUR OUTPUT = the exact message that will be sent. Nothing else.

STRICT OUTPUT RULES:
- Return ONLY the message text, ready to send as-is
- NEVER include intros like "Here's the DM:" or "Opening message for..."
- NEVER include commentary like "Why this works" or "This message..."
- NEVER include separators like "---" or "***"
- NEVER include markdown formatting like **bold** or bullet points
- NEVER include labels, headers, or meta-text of any kind
- NEVER wrap the message in quotes

STYLE:
- Natural, warm opening (2-4 sentences)
- Reference their comment to show genuine interest
- Be helpful and conversational, not salesy
- Use their first name naturally
- End with an open question or soft call-to-action
- Keep it under 500 characters for LinkedIn DM best practices`;

  const response = await fetchChatCompletions({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Write the DM to ${firstName}.` },
    ],
    temperature: 0.7,
    max_tokens: 300,
  }, {
    openRouterApiKey,
    referer,
    ...(llmCtx || {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const message = sanitizeAIOutput(data.choices?.[0]?.message?.content?.trim() || '');

  if (!message) {
    throw new Error('Empty response from LLM for initial message');
  }

  return {
    message,
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

/**
 * Build the system prompt for an AI chatbot conversation.
 * This is stored on the ai_chatbot_conversations record for reuse across turns.
 */
export function buildChatbotSystemPrompt(input: {
  commenterName: string;
  commenterHeadline: string | null;
  commentText: string;
  icpScore: number;
  icpReasoning: string;
  chatbotInstructions: string;
  brandVoice?: {
    tone: string | null;
    personality: string | null;
    writing_examples: string[] | null;
  } | null;
}): string {
  const brandVoiceSection = input.brandVoice
    ? `\nBRAND VOICE:
- Tone: ${input.brandVoice.tone || 'professional'}
- Personality: ${input.brandVoice.personality || 'helpful'}
${input.brandVoice.writing_examples?.length ? `- Examples of style: ${input.brandVoice.writing_examples.slice(0, 2).join('; ')}` : ''}`
    : '';

  return `You are an AI assistant having a conversation via direct message on behalf of a brand.

CONTEXT:
- You are talking to ${input.commenterName}
- They commented "${input.commentText}" on a social media post
- Their LinkedIn headline: ${input.commenterHeadline || 'Not available'}
- ICP match score: ${input.icpScore}/100 — ${input.icpReasoning}

YOUR ROLE:
${input.chatbotInstructions}
${brandVoiceSection}

RULES:
1. Be helpful and conversational, not salesy
2. Keep responses concise (2-4 sentences max)
3. If asked something you cannot answer, say you'll connect them with the team
4. Never make up specific claims about products or services
5. If they seem uninterested, thank them and end gracefully
6. Stay on topic related to what they expressed interest in
7. Use their first name naturally`;
}
