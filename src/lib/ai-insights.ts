/**
 * Unified AI Insights Resolution — Frontend
 *
 * Single source of truth for AI insight variable definitions and resolution
 * in preview components. Mirrors the backend _shared/ai-insights.ts logic.
 */
import { cleanList, guardrailsText, guidelinesText } from '@/lib/idea-guidelines';

/** All AI insight variable names that may appear in templates */
export const ALL_AI_VARS = [
  'ai_hook', 'ai_hook_type', 'ai_hooks', 'ai_hooks_list',
  'ai_cta', 'ai_cta_placement', 'ai_cta_type', 'ai_ctas', 'ai_ctas_list',
  'ai_talking_points', 'ai_talking_points_list', 'ai_talking_point',
  'ai_script_structure', 'ai_script_opening', 'ai_script_body', 'ai_script_climax', 'ai_script_closing',
  'ai_engagement_drivers', 'ai_engagement_drivers_list',
  'ai_guidelines', 'ai_guardrails', 'ai_avoid',
] as const;

export const AI_INSIGHT_VARIABLES = new Set<string>(ALL_AI_VARS);

/** Maps template variable → possible field paths in ai_analysis */
export const AI_INSIGHT_FIELD_MAP: Record<string, string[]> = {
  'ai_talking_points': ['talking_points'],
  'ai_talking_points_list': ['talking_points'],
  'ai_talking_point': ['talking_points'],
  'ai_hooks': ['hooks'],
  'ai_hooks_list': ['hooks'],
  'ai_hook': ['hooks'],
  'ai_hook_type': ['hooks'],
  'ai_ctas': ['ctas'],
  'ai_ctas_list': ['ctas'],
  'ai_cta': ['ctas'],
  'ai_cta_placement': ['ctas'],
  'ai_cta_type': ['ctas'],
  'ai_script_structure': ['script_structure'],
  'ai_script_opening': ['script_structure'],
  'ai_script_body': ['script_structure'],
  'ai_script_climax': ['script_structure'],
  'ai_script_closing': ['script_structure'],
  'ai_engagement_drivers': ['engagement_drivers'],
  'ai_engagement_drivers_list': ['engagement_drivers'],
  'ai_guidelines': ['talking_points', 'avoid'],
  'ai_guardrails': ['talking_points', 'avoid'],
  'ai_avoid': ['avoid'],
};

/** Display-friendly names for AI insight variables */
export const AI_INSIGHT_DISPLAY_NAMES: Record<string, string> = {
  'ai_talking_points': 'Talking Points',
  'ai_talking_points_list': 'Talking Points',
  'ai_talking_point': 'Talking Point (variation)',
  'ai_hooks': 'Hooks',
  'ai_hooks_list': 'Hooks',
  'ai_hook': 'Hook',
  'ai_hook_type': 'Hook Type',
  'ai_ctas': 'CTAs',
  'ai_ctas_list': 'CTAs',
  'ai_cta': 'CTA',
  'ai_cta_placement': 'CTA Placement',
  'ai_cta_type': 'CTA Type',
  'ai_script_structure': 'Script Structure',
  'ai_script_opening': 'Script Opening',
  'ai_script_body': 'Script Body',
  'ai_script_climax': 'Script Climax',
  'ai_script_closing': 'Script Closing',
  'ai_engagement_drivers': 'Engagement Drivers',
  'ai_engagement_drivers_list': 'Engagement Drivers',
  'ai_guidelines': 'Idea guidelines',
  'ai_guardrails': 'Guardrails',
  'ai_avoid': "Don't mention",
};

/** Maps variables that need a specific sub-field from array items (not .text) */
const SUB_FIELD_MAP: Record<string, string> = {
  'ai_cta_placement': 'placement',
  'ai_cta_type': 'type',
  'ai_hook_type': 'type',
};

/**
 * Resolve an AI insight variable from raw ai_analysis data.
 * Returns the formatted string value or null if not available.
 */
export function resolveAiVarFromAnalysis(
  varName: string,
  analysis: Record<string, any>,
): string | null {
  // Guidelines are built from several fields (see idea-guidelines.ts)
  if (varName === 'ai_guidelines' || varName === 'ai_guardrails' || varName === 'ai_avoid') {
    const points = cleanList(analysis.talking_points);
    const avoid = cleanList(analysis.avoid);
    if (varName === 'ai_avoid') return avoid.length ? avoid.map((a) => `• ${a}`).join('\n') : null;
    if (!points.length && !avoid.length) return null;
    return varName === 'ai_guidelines' ? guidelinesText(points, avoid) : guardrailsText(avoid);
  }

  const fieldPaths = AI_INSIGHT_FIELD_MAP[varName];
  if (!fieldPaths) return null;

  for (const fieldPath of fieldPaths) {
    const value = analysis[fieldPath];
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;

      // Sub-field extraction (ai_cta_placement, ai_cta_type, ai_hook_type)
      const subField = SUB_FIELD_MAP[varName];
      if (subField) {
        const firstItem = value[0];
        return typeof firstItem === 'object' ? (firstItem[subField] || '') : '';
      }

      // Plural formatted vars (ai_ctas, ai_hooks)
      if (varName === 'ai_ctas' || varName === 'ai_hooks') {
        return value.map((item: any, i: number) => {
          if (typeof item === 'object') {
            const detail = item.placement || item.type || '';
            return `${i + 1}. "${item.text}"${detail ? ` (${detail})` : ''}`;
          }
          return `${i + 1}. ${String(item)}`;
        }).join('\n');
      }

      // List vars (ai_hooks_list, ai_ctas_list)
      if (varName.includes('_list')) {
        return value.map((item: any) =>
          typeof item === 'object' ? (item.text || item.point || JSON.stringify(item)) : String(item)
        ).join(', ');
      }

      // Talking points bullet format
      if (varName === 'ai_talking_points') {
        return value.map((p: string) => `• ${p}`).join('\n');
      }
      if (varName === 'ai_talking_points_list') {
        return value.join(', ');
      }

      // Single talking point (variation)
      if (varName === 'ai_talking_point') {
        return typeof value[0] === 'object' ? (value[0].text || '') : String(value[0]);
      }

      // Engagement drivers
      if (varName === 'ai_engagement_drivers') {
        return value.map((d: string) => `• ${d}`).join('\n');
      }
      if (varName === 'ai_engagement_drivers_list') {
        return value.join(', ');
      }

      // Default single item (ai_hook, ai_cta)
      const firstItem = value[0];
      return typeof firstItem === 'object'
        ? (firstItem.text || firstItem.point || JSON.stringify(firstItem))
        : String(firstItem);
    }

    // Object (script_structure)
    if (typeof value === 'object') {
      if (varName === 'ai_script_structure') {
        const parts: string[] = [];
        if (value.opening) parts.push(`Opening: ${value.opening}`);
        if (value.body) parts.push(`Body: ${value.body}`);
        if (value.climax) parts.push(`Climax: ${value.climax}`);
        if (value.closing) parts.push(`Closing: ${value.closing}`);
        return parts.join('\n');
      }
      // Individual script fields
      const scriptFieldMap: Record<string, string> = {
        'ai_script_opening': 'opening',
        'ai_script_body': 'body',
        'ai_script_climax': 'climax',
        'ai_script_closing': 'closing',
      };
      if (scriptFieldMap[varName]) {
        return value[scriptFieldMap[varName]] || '';
      }
      return JSON.stringify(value, null, 2);
    }

    // Primitive
    return String(value);
  }

  return null;
}

/**
 * Resolve an AI variable for preview tooltip display.
 * Returns { value, source, status } for use in PromptPreview tooltips.
 */
export function resolveAiVarForPreview(
  varName: string,
  ideaAiAnalysis?: Record<string, any>,
): { value: string | null; source: string; status: 'resolved' | 'missing' } {
  const displayName = AI_INSIGHT_DISPLAY_NAMES[varName] || varName;

  if (!ideaAiAnalysis) {
    return { value: null, source: `AI ${displayName} not available`, status: 'missing' };
  }

  // Check all ideas for the data
  for (const ideaId of Object.keys(ideaAiAnalysis)) {
    const rawAnalysis = ideaAiAnalysis[ideaId];
    if (!rawAnalysis) continue;

    let analysis: Record<string, any>;
    try {
      analysis = typeof rawAnalysis === 'string' ? JSON.parse(rawAnalysis) : rawAnalysis;
    } catch {
      continue;
    }

    const resolved = resolveAiVarFromAnalysis(varName, analysis);
    if (resolved !== null && resolved !== '') {
      const truncated = resolved.length > 100 ? resolved.substring(0, 100) + '...' : resolved;
      return { value: truncated, source: `AI ${displayName}`, status: 'resolved' };
    }
  }

  return { value: null, source: `AI ${displayName} not available`, status: 'missing' };
}

/**
 * Resolve an AI variable for full prompt resolution (ResolvedPromptPreview).
 * Returns the formatted string value or null.
 */
export function resolveAiVarForPrompt(
  varName: string,
  aiAnalysis?: Record<string, any> | string | null,
): string | null {
  if (!aiAnalysis) return null;

  let analysis: Record<string, any>;
  try {
    analysis = typeof aiAnalysis === 'string' ? JSON.parse(aiAnalysis) : aiAnalysis;
  } catch {
    return null;
  }

  return resolveAiVarFromAnalysis(varName, analysis);
}
