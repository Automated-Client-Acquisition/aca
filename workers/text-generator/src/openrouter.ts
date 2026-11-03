// Pricing per million tokens (approximate)

import { normalizeDashes } from './dash-rules.js';
const PRICING_MAP: Record<string, number> = {
  'google/gemini-3-flash-preview': 0.003,
  'meta-llama/llama-3.1-8b-instruct:free': 0,
  'anthropic/claude-3-haiku': 0.25,
  'anthropic/claude-3-sonnet': 3.0,
  'openai/gpt-4o': 5.0,
  'openai/gpt-4o-mini': 0.15,
};

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LLMResult {
  content: string;
  model: string;
  usage: LLMUsage;
  cost: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelConfig {
  model: string;
  temperature?: number;
  max_tokens?: number;
}

export function calculateCost(usage: LLMUsage | undefined, modelId: string): number {
  const tokensUsed = usage?.total_tokens || 0;
  const costPerMToken = PRICING_MAP[modelId] || 0.10;
  return (tokensUsed / 1_000_000) * costPerMToken;
}

export async function callOpenRouter(
  messages: ChatMessage[],
  config: ModelConfig,
  apiKey: string,
  referer: string,
): Promise<LLMResult> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
  };
  if (config.temperature !== undefined) body.temperature = config.temperature;
  if (config.max_tokens !== undefined) body.max_tokens = config.max_tokens;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': referer,
      'X-Title': 'ContentAI Studio',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000), // 2 min timeout to prevent infinite hangs
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
  }

  const result = await response.json();
  let content: string = result.choices?.[0]?.message?.content || '';
  const cost = calculateCost(result.usage, config.model);

  // Fix AI typography
  content = fixAITypography(content);

  // Extract JSON from code blocks if present
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const extracted = codeBlockMatch[1].trim();
    if (extracted.startsWith('{') || extracted.startsWith('[')) {
      content = extracted;
    }
  }

  // Clean markdown from non-JSON text output
  const isJson = content.trim().startsWith('{') || content.trim().startsWith('[');
  if (!isJson) {
    content = cleanTextOutput(content);
  }

  return {
    content,
    model: result.model || config.model,
    usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    cost,
  };
}

// Retry wrapper: 1 retry on 5xx or network errors
export async function callOpenRouterWithRetry(
  messages: ChatMessage[],
  config: ModelConfig,
  apiKey: string,
  referer: string,
): Promise<LLMResult> {
  try {
    return await callOpenRouter(messages, config, apiKey, referer);
  } catch (err: any) {
    const is5xx = err.message?.includes('API error 5');
    const isNetwork = err.message?.includes('fetch failed') || err.message?.includes('ECONNREFUSED');
    if (is5xx || isNetwork) {
      console.log(`[OpenRouter] Retrying after error: ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
      return await callOpenRouter(messages, config, apiKey, referer);
    }
    throw err;
  }
}

function fixAITypography(text: string): string {
  if (!text) return text;
  return normalizeDashes(text)
    .replace(/[\u201C\u201D]/g, '"') // smart double quotes
    .replace(/[\u2018\u2019]/g, "'") // smart single quotes
    .replace(/\u2026/g, '...');      // ellipsis
}

function cleanTextOutput(content: string): string {
  if (!content) return content;
  let cleaned = content;

  // Remove markdown code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  // Remove inline code
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  // Remove markdown headers
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  // Remove bold markers
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  // Remove italic markers
  cleaned = cleaned.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1');
  cleaned = cleaned.replace(/(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g, '$1');
  // Remove blockquotes
  cleaned = cleaned.replace(/^>\s*/gm, '');
  // Remove horizontal rules
  cleaned = cleaned.replace(/^[-*_]{3,}\s*$/gm, '');
  // Remove markdown links but keep text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove common LLM prefixes
  const prefixPatterns = [
    /^(?:Here(?:'s| is) (?:a |the |your )?(?:caption|post|content)[:\s]*)/im,
    /^(?:Caption[:\s]*)/im,
    /^(?:Post[:\s]*)/im,
    /^(?:Social media (?:post|caption)[:\s]*)/im,
    /^(?:Output[:\s]*)/im,
  ];
  for (const pattern of prefixPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove trailing notes/explanations
  const suffixPatterns = [
    /\n+(?:---|\*\*\*)\n+[\s\S]*$/,
    /\n+(?:Note|Notes|Explanation|Tips?)[:\s][\s\S]*$/i,
    /\n+(?:Let me know|Hope this helps|Feel free)[\s\S]*$/i,
  ];
  for (const pattern of suffixPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = fixAITypography(cleaned);
  return cleaned.trim();
}
