/**
 * Unified AI Insights Resolution
 *
 * Single source of truth for extracting AI insight variables from:
 * 1. ideaAiAnalysis (raw ai_analysis JSONB from content_ideas)
 * 2. selectedAiInsights (user-selected specific items from wizard/autopilot)
 * 3. directKeyTalkingPoints (legacy separate column, fallback only)
 *
 * Resolution order: ideaAiAnalysis provides base values, selectedAiInsights overrides.
 * ai_guidelines / ai_guardrails / ai_avoid come from the idea's guidelines (idea-guidelines.ts).
 */
import { cleanList, guardrailsText, guidelinesText } from './idea-guidelines.ts';

export interface AiInsightHook {
  text: string;
  type: string;
}

export interface AiInsightCta {
  text: string;
  placement?: string;
  type?: string;
}

export interface AiInsightScriptStructure {
  opening?: string;
  body?: string;
  climax?: string;
  closing?: string;
}

export interface SelectedAiInsights {
  hook?: AiInsightHook;
  hooks?: AiInsightHook[];
  cta?: AiInsightCta;
  ctas?: AiInsightCta[];
  talking_points?: string[];
  talking_point?: { text: string };
  script_structure?: AiInsightScriptStructure;
  engagement_drivers?: string[];
}

/** Flat map of all resolved ai_* variable values */
export type AiInsightVarMap = Record<string, string>;

/**
 * Parse ai_analysis from string or object form.
 */
function parseAnalysis(raw: any): any | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      // Handle double-serialized case (string-within-a-string from JSONB)
      if (typeof parsed === 'string') {
        try { return JSON.parse(parsed); } catch { return null; }
      }
      return parsed;
    } catch { return null; }
  }
  return raw;
}

/**
 * Resolve all AI insight variables into a flat string map.
 *
 * @param ideaAiAnalysis - Raw ai_analysis from content_ideas (string or object)
 * @param selectedAiInsights - User-selected insights (from wizard or autopilot)
 * @returns Flat map of variable name -> resolved string value
 */
export function resolveAiInsightVars(
  ideaAiAnalysis?: any,
  selectedAiInsights?: SelectedAiInsights | null,
): AiInsightVarMap {
  const vars: AiInsightVarMap = {};
  const parsed = parseAnalysis(ideaAiAnalysis);

  // Debug: trace what data we're working with
  console.log(`[resolveAiInsightVars] input type: ${typeof ideaAiAnalysis}, parsed: ${parsed ? 'yes' : 'no'}, parsed keys: ${parsed ? Object.keys(parsed).join(',') : 'none'}`);
  console.log(`[resolveAiInsightVars] selectedAiInsights: ${selectedAiInsights ? Object.keys(selectedAiInsights).join(',') : 'none'}`);
  if (parsed) {
    console.log(`[resolveAiInsightVars] parsed data: hooks=${parsed.hooks?.length || 0}, ctas=${parsed.ctas?.length || 0}, talking_points=${parsed.talking_points?.length || 0}`);
  }

  // --- Phase 1: Base values from ai_analysis ---
  if (parsed) {
    // Hooks
    const hooks: AiInsightHook[] = parsed?.hooks || [];
    if (hooks.length > 0) {
      vars.ai_hooks = hooks.map((h, i) => `${i + 1}. "${h.text}" (${h.type})`).join('\n');
      vars.ai_hooks_list = hooks.map(h => h.text).join(' | ');
      vars.ai_hook = hooks[0]?.text || '';
      vars.ai_hook_type = hooks[0]?.type || '';
    }

    // CTAs
    const ctas: AiInsightCta[] = parsed?.ctas || [];
    if (ctas.length > 0) {
      vars.ai_ctas = ctas.map((c, i) => `${i + 1}. "${c.text}" (${c.placement || c.type})`).join('\n');
      vars.ai_ctas_list = ctas.map(c => c.text).join(' | ');
      vars.ai_cta = ctas[0]?.text || '';
      vars.ai_cta_placement = ctas[0]?.placement || '';
      vars.ai_cta_type = ctas[0]?.type || '';
    }

    // Talking points — single source of truth: ai_analysis.talking_points
    const talkingPoints = parsed?.talking_points || [];
    if (talkingPoints.length > 0) {
      vars.ai_talking_points = talkingPoints.map((p: string) => `• ${p}`).join('\n');
      vars.ai_talking_points_list = talkingPoints.join(', ');
    }

    // Script structure
    const ss = parsed?.script_structure;
    if (ss) {
      vars.ai_script_opening = ss.opening || '';
      vars.ai_script_body = ss.body || '';
      vars.ai_script_climax = ss.climax || '';
      vars.ai_script_closing = ss.closing || '';
      const parts: string[] = [];
      if (ss.opening) parts.push(`Opening: ${ss.opening}`);
      if (ss.body) parts.push(`Body: ${ss.body}`);
      if (ss.climax) parts.push(`Climax: ${ss.climax}`);
      if (ss.closing) parts.push(`Closing: ${ss.closing}`);
      vars.ai_script_structure = parts.join('\n');
    }

    // Engagement drivers
    const drivers: string[] = parsed?.engagement_drivers || [];
    if (drivers.length > 0) {
      vars.ai_engagement_drivers = drivers.map((d: string) => `• ${d}`).join('\n');
      vars.ai_engagement_drivers_list = drivers.join(', ');
    }
  }

  // --- Phase 2: Override with selected insights ---
  if (selectedAiInsights) {
    // Hooks — array form (COMBINE mode) or single
    if (selectedAiInsights.hooks?.length) {
      const h = selectedAiInsights.hooks;
      vars.ai_hooks = h.map((hook, i) => `${i + 1}. "${hook.text}" (${hook.type})`).join('\n');
      vars.ai_hooks_list = h.map(hook => hook.text).join(' | ');
      vars.ai_hook = h[0].text || '';
      vars.ai_hook_type = h[0].type || '';
    } else if (selectedAiInsights.hook) {
      vars.ai_hook = selectedAiInsights.hook.text || '';
      vars.ai_hook_type = selectedAiInsights.hook.type || '';
      vars.ai_hooks = `• ${selectedAiInsights.hook.text || ''}`;
      vars.ai_hooks_list = selectedAiInsights.hook.text || '';
    }

    // CTAs — array form or single
    if (selectedAiInsights.ctas?.length) {
      const c = selectedAiInsights.ctas;
      vars.ai_ctas = c.map((cta, i) => `${i + 1}. "${cta.text}" (${cta.placement || cta.type})`).join('\n');
      vars.ai_ctas_list = c.map(cta => cta.text).join(' | ');
      vars.ai_cta = c[0].text || '';
      vars.ai_cta_placement = c[0].placement || '';
      vars.ai_cta_type = c[0].type || '';
    } else if (selectedAiInsights.cta) {
      vars.ai_cta = selectedAiInsights.cta.text || '';
      vars.ai_cta_placement = selectedAiInsights.cta.placement || '';
      vars.ai_cta_type = selectedAiInsights.cta.type || '';
      vars.ai_ctas = `• ${selectedAiInsights.cta.text || ''}`;
      vars.ai_ctas_list = selectedAiInsights.cta.text || '';
    }

    // Talking points
    if (selectedAiInsights.talking_points?.length) {
      vars.ai_talking_points = selectedAiInsights.talking_points.map((p: string) => `• ${p}`).join('\n');
      vars.ai_talking_points_list = selectedAiInsights.talking_points.join(', ');
    }

    // Single talking point (for variations)
    if (selectedAiInsights.talking_point) {
      vars.ai_talking_point = selectedAiInsights.talking_point.text || '';
    }

    // Script structure
    if (selectedAiInsights.script_structure) {
      const ss = selectedAiInsights.script_structure;
      vars.ai_script_opening = ss.opening || '';
      vars.ai_script_body = ss.body || '';
      vars.ai_script_climax = ss.climax || '';
      vars.ai_script_closing = ss.closing || '';
      vars.ai_script_structure = [
        ss.opening ? `Opening: ${ss.opening}` : '',
        ss.body ? `Body: ${ss.body}` : '',
        ss.climax ? `Climax: ${ss.climax}` : '',
        ss.closing ? `Closing: ${ss.closing}` : ''
      ].filter(Boolean).join('\n\n');
    }

    // Engagement drivers
    if (selectedAiInsights.engagement_drivers?.length) {
      vars.ai_engagement_drivers = selectedAiInsights.engagement_drivers.map((d: string) => `• ${d}`).join('\n');
      vars.ai_engagement_drivers_list = selectedAiInsights.engagement_drivers.join(', ');
    }
  }

  // --- Phase 3: Idea guidelines (points to make, what to avoid, the facts rule) ---
  const points = selectedAiInsights?.talking_points?.length
    ? cleanList(selectedAiInsights.talking_points)
    : cleanList(parsed?.talking_points);
  const avoid = cleanList(parsed?.avoid);
  if (points.length || avoid.length) {
    vars.ai_guidelines = guidelinesText(points, avoid);
    vars.ai_guardrails = guardrailsText(avoid);
  }
  if (avoid.length) vars.ai_avoid = avoid.map((a) => `• ${a}`).join('\n');

  const resolvedKeys = Object.keys(vars).filter(k => vars[k]);
  console.log(`[resolveAiInsightVars] resolved ${resolvedKeys.length} vars: ${resolvedKeys.join(', ')}`);

  return vars;
}

/** All AI insight variable names that may appear in templates */
export const ALL_AI_VARS = [
  'ai_hook', 'ai_hook_type', 'ai_hooks', 'ai_hooks_list',
  'ai_cta', 'ai_cta_placement', 'ai_cta_type', 'ai_ctas', 'ai_ctas_list',
  'ai_talking_points', 'ai_talking_points_list', 'ai_talking_point',
  'ai_script_structure', 'ai_script_opening', 'ai_script_body', 'ai_script_climax', 'ai_script_closing',
  'ai_engagement_drivers', 'ai_engagement_drivers_list',
  'ai_guidelines', 'ai_guardrails', 'ai_avoid',
] as const;

/**
 * Apply resolved AI insight vars to a context object (for execute-stage).
 * Only sets keys that have values — doesn't clear missing ones.
 */
export function applyAiInsightsToContext(
  context: Record<string, string>,
  ideaAiAnalysis?: any,
  selectedAiInsights?: SelectedAiInsights | null,
): void {
  const vars = resolveAiInsightVars(ideaAiAnalysis, selectedAiInsights);
  for (const [key, value] of Object.entries(vars)) {
    context[key] = value;
  }
}
