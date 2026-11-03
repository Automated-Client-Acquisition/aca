/**
 * LLM Planner Module
 *
 * Takes recon data (DOM summary, initial screenshot, brief, template)
 * and calls OpenRouter to generate a sequence of capture steps.
 */

import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  buildRecoverySystemPrompt,
  buildRecoveryUserPrompt,
  type TemplateType,
  type PlannerPromptInput,
} from './prompts.js';

// ============================================================================
// Types
// ============================================================================

export interface FlowStep {
  action: 'click' | 'scroll' | 'screenshot' | 'wait' | 'type';
  selector?: string;
  area?: string;
  narrate?: string;
  ms?: number;
  to?: string;
  value?: string;
}

export interface PlannerInput {
  domSummary: string;
  initialScreenshotBase64: string;
  brief: string;
  templateType: TemplateType;
  maxScreenshots: number;
  currentUrl: string;
}

export interface RecoveryInput {
  failedStep: { action: string; selector?: string };
  errorMessage: string;
  domSummary: string;
  screenshotBase64: string;
}

export interface RecoveryResult {
  action: 'click' | 'scroll' | 'wait' | 'skip';
  selector?: string;
  to?: string;
  ms?: number;
  reason: string;
}

// ============================================================================
// Config
// ============================================================================

const DEFAULT_PLANNER_MODEL = 'anthropic/claude-sonnet-4';
const PLANNER_TIMEOUT_MS = 30_000;

// ============================================================================
// OpenRouter API Call
// ============================================================================

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
  timeoutMs: number = PLANNER_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from LLM');
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Plan Generation
// ============================================================================

export async function generatePlan(
  apiKey: string,
  input: PlannerInput,
  model?: string,
): Promise<FlowStep[]> {
  const llmModel = model || DEFAULT_PLANNER_MODEL;
  console.log(`[Planner] Generating plan with ${llmModel} for "${input.brief.slice(0, 60)}..."`);

  const systemPrompt = buildPlannerSystemPrompt(input.templateType);
  const promptInput: PlannerPromptInput = {
    domSummary: input.domSummary,
    brief: input.brief,
    templateType: input.templateType,
    maxScreenshots: input.maxScreenshots,
    currentUrl: input.currentUrl,
  };
  const userPrompt = buildPlannerUserPrompt(promptInput);

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${input.initialScreenshotBase64}` },
        },
      ],
    },
  ];

  const raw = await callOpenRouter(apiKey, llmModel, messages);

  // Parse the response — handle both raw array and wrapped object
  let steps: FlowStep[];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      steps = parsed;
    } else if (parsed.steps && Array.isArray(parsed.steps)) {
      steps = parsed.steps;
    } else {
      // Try to find any array value in the object
      const arrays = Object.values(parsed).filter(Array.isArray);
      if (arrays.length > 0) {
        steps = arrays[0] as FlowStep[];
      } else {
        throw new Error('Response contains no step array');
      }
    }
  } catch (parseErr: any) {
    console.error('[Planner] Failed to parse LLM response:', raw.slice(0, 500));
    throw new Error(`Failed to parse planner response: ${parseErr.message}`);
  }

  // Validate and sanitize steps
  steps = steps.filter((step) => {
    if (!step.action) return false;
    const validActions = ['click', 'scroll', 'screenshot', 'wait', 'type'];
    if (!validActions.includes(step.action)) return false;
    return true;
  });

  // Ensure at least one screenshot step exists
  const hasScreenshot = steps.some(s => s.action === 'screenshot');
  if (!hasScreenshot && steps.length > 0) {
    steps.push({ action: 'screenshot', area: 'current view', narrate: 'Page overview' });
  }

  // Count screenshot steps and enforce max
  let screenshotCount = 0;
  steps = steps.filter((step) => {
    if (step.action === 'screenshot') {
      screenshotCount++;
      return screenshotCount <= input.maxScreenshots;
    }
    return true;
  });

  console.log(`[Planner] Generated ${steps.length} steps (${screenshotCount} screenshots)`);
  return steps;
}

// ============================================================================
// Recovery (when an action fails, ask the LLM for help)
// ============================================================================

export async function planRecovery(
  apiKey: string,
  input: RecoveryInput,
  model?: string,
): Promise<RecoveryResult> {
  const llmModel = model || DEFAULT_PLANNER_MODEL;
  console.log(`[Planner] Planning recovery for failed ${input.failedStep.action} on "${input.failedStep.selector || 'N/A'}"`);

  const systemPrompt = buildRecoverySystemPrompt();
  const userPrompt = buildRecoveryUserPrompt(
    input.failedStep,
    input.errorMessage,
    input.domSummary,
  );

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${input.screenshotBase64}` },
        },
      ],
    },
  ];

  try {
    const raw = await callOpenRouter(apiKey, llmModel, messages, 15_000);
    const parsed = JSON.parse(raw);

    return {
      action: parsed.action || 'skip',
      selector: parsed.selector,
      to: parsed.to,
      ms: parsed.ms,
      reason: parsed.reason || 'No reason provided',
    };
  } catch (err: any) {
    console.error('[Planner] Recovery planning failed:', err.message);
    return {
      action: 'skip',
      reason: `Recovery planning failed: ${err.message}`,
    };
  }
}
