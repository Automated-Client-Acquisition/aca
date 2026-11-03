/**
 * Prompt resolution shared by dispatch-generation-job (real runs) and
 * preview-blueprint (Studio previews), so a preview resolves {{variables}},
 * library fields and {{#sections}} exactly the way a run does.
 * Moved verbatim from dispatch-generation-job/index.ts.
 */
import { resolveAiInsightVars, ALL_AI_VARS } from './ai-insights.ts';
import { cleanList, guardrailsText } from './idea-guidelines.ts';
import { renderPromptSections } from './blueprint-variables.ts';

// Shorthand mapping for library table names
// Maps shorthand variable names (used in prompts) to full table names
export const SHORTHAND_MAP: Record<string, string> = {
  'product': 'library_products',
  'brand': 'library_brand_voices',
  'brand_voice': 'library_brand_voices', // Legacy alias for backwards compatibility
  'character': 'library_characters',
  'icp': 'library_icps',
  'identity': 'library_identities',
  'block': 'library_blocks'
};

// Reverse mapping: full table name -> shorthand (use preferred shorthand, not legacy aliases)
export const REVERSE_SHORTHAND_MAP: Record<string, string> = {
  'library_products': 'product',
  'library_brand_voices': 'brand',  // Use 'brand' not 'brand_voice'
  'library_characters': 'character',
  'library_icps': 'icp',
  'library_identities': 'identity',
  'library_blocks': 'block'
};

// Selected AI insights for a single variation
export interface GenerationItemAiInsights {
  // Single hook (for separate mode - one output per hook)
  hook?: { text: string; type: string; index: number };
  // Multiple hooks (for combine mode - all selected hooks in one output)
  hooks?: Array<{ text: string; type: string; index: number }>;
  // Single CTA (legacy/separate mode)
  cta?: { text: string; placement: string; type: string } | null;
  // Multiple CTAs (for combine mode - all selected CTAs in one output)
  ctas?: Array<{ text: string; placement: string; type: string; index: number }>;
  talking_points?: string[];
  talking_point?: { text: string; index: number }; // Single talking point for variations
  script_structure?: {
    opening?: string;
    body?: string;
    climax?: string;
    closing?: string;
  };
  engagement_drivers?: string[];
}

/**
 * Transform library elements from full table names to shorthand names
 */
export function transformLibraryKeys(libraryElements: Record<string, any>): Record<string, any> {
  const transformed: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(libraryElements)) {
    const shorthand = REVERSE_SHORTHAND_MAP[key];
    if (shorthand) {
      transformed[shorthand] = value;
    } else {
      // Keep unknown keys as-is
      transformed[key] = value;
    }
  }
  
  return transformed;
}

/**
 * Convert camelCase to snake_case
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Reconstruct nested structure for flattened product schema
 * Apply selected items filtering from nested path selection
 */
function reconstructNestedFields(
  element: any,
  selectedPaths?: Record<string, { included: boolean; selectedItems?: string[]; combinationMode?: 'combine' | 'separate' }>
): any {
  const reconstructed = { ...element };
  
  // Helper function to filter array based on selectedItems
  const filterArray = (fieldKey: string, items: any[]): any[] => {
    if (!selectedPaths || !selectedPaths[fieldKey]) return items;
    
    const pathConfig = selectedPaths[fieldKey];
    if (!pathConfig.included || !pathConfig.selectedItems || pathConfig.selectedItems.length === 0) {
      return items;
    }
    
    // Filter to only selected items
    const selectedSet = new Set(pathConfig.selectedItems);
    return items.filter(item => selectedSet.has(String(item)));
  };
  
  // Reconstruct ICP nested structure from flat fields
  if (element.icp_age_range || element.icp_gender || element.icp_job_titles) {
    reconstructed.icp = {
      ageRange: element.icp_age_range,
      gender: element.icp_gender,
      income: element.icp_income,
      location: element.icp_location,
      jobTitles: filterArray('icp_job_titles', element.icp_job_titles || []),
      psychographics: filterArray('icp_psychographics', element.icp_psychographics || []),
      painPoints: filterArray('icp_pain_points', element.icp_pain_points || []),
      desires: filterArray('icp_desires', element.icp_desires || []),
      buyingMotivations: filterArray('icp_buying_motivations', element.icp_buying_motivations || [])
    };
  }
  
  // Reconstruct marketing nested structure
  if (element.marketing_primary_angle || element.marketing_hooks) {
    reconstructed.marketing = {
      primaryAngle: element.marketing_primary_angle,
      hooks: filterArray('marketing_hooks', element.marketing_hooks || []),
      urgencyFactors: filterArray('marketing_urgency_factors', element.marketing_urgency_factors || []),
      alternativeAngles: filterArray('marketing_alternative_angles', element.marketing_alternative_angles || []),
      emotionalTriggers: filterArray('marketing_emotional_triggers', element.marketing_emotional_triggers || [])
    };
  }
  
  // Reconstruct affiliate nested structure
  if (element.affiliate_key_messages || element.affiliate_content_ideas) {
    reconstructed.affiliate = {
      keyMessages: filterArray('affiliate_key_messages', element.affiliate_key_messages || []),
      contentIdeas: filterArray('affiliate_content_ideas', element.affiliate_content_ideas || []),
      callsToAction: filterArray('affiliate_calls_to_action', element.affiliate_calls_to_action || []),
      targetPlatforms: filterArray('affiliate_target_platforms', element.affiliate_target_platforms || []),
      recommendedApproach: element.affiliate_recommended_approach
    };
  }
  
  // Also filter top-level array fields like features
  if (element.features && Array.isArray(element.features)) {
    reconstructed.features = filterArray('features', element.features);
  }
  
  return reconstructed;
}

/**
 * Every name a library element can be referenced by in a prompt: its shorthand
 * ('brand'), full table name ('library_brand_voices') and any alias ('brand_voice').
 */
function libraryPatterns(elementKey: string): string[] {
  const patterns: string[] = [elementKey];
  const fullTableName = SHORTHAND_MAP[elementKey];
  if (fullTableName) {
    patterns.push(fullTableName);
    Object.entries(SHORTHAND_MAP).forEach(([alias, table]) => {
      if (table === fullTableName && alias !== elementKey && !patterns.includes(alias)) {
        patterns.push(alias);
      }
    });
  }
  return patterns;
}

/** Walk a dotted field path ("icp.jobTitles"), falling back to snake_case per segment. */
function getLibraryFieldValue(element: any, fieldPath: string): any {
  let value = element;
  for (const part of fieldPath.split('.')) {
    if (value?.[part] !== undefined) {
      value = value[part];
    } else if (value?.[camelToSnake(part)] !== undefined) {
      value = value[camelToSnake(part)];
    } else {
      return undefined;
    }
  }
  return value;
}

// Blueprint Studio compiled this line into master_prompt before guidelines
// existed, and saved prompts keep it until someone edits the blueprint.
const LEGACY_TALKING_POINTS_SECTION =
  /\{\{#ai_talking_points\}\}Points you can draw on\. Use the strongest two or three and skip the rest:\s*\{\{ai_talking_points\}\}\s*\{\{\/ai_talking_points\}\}/g;
const GUIDELINES_SECTION = '{{#ai_guidelines}}{{ai_guidelines}}\n{{/ai_guidelines}}';

function mentionsVar(template: string, names: string[]): boolean {
  return names.some((n) => new RegExp(`\\{\\{\\s*[#^]?\\s*${n}\\s*\\}\\}`, 'i').test(template));
}

export interface ResolvePromptOptions {
  /**
   * The writing prompt of a run: make sure the idea's guidelines reach it even
   * when the template never mentions them. Off for image and director prompts.
   */
  appendGuidelines?: boolean;
  /**
   * A person approved the idea's guidelines, so its points are rules and go into
   * any writing prompt. Unreviewed points only reach prompts that ask for them;
   * the avoid list and the facts rule always do.
   */
  guidelinesApproved?: boolean;
}

export function resolvePrompt(
  template: string,
  slotValues: Record<string, string>,
  libraryElements: Record<string, any>,
  selectedPaths?: Record<string, Record<string, { included: boolean; selectedItems?: string[]; combinationMode?: 'combine' | 'separate' }>>,
  selectedAiInsights?: GenerationItemAiInsights,
  ideaAiAnalysis?: any,
  options: ResolvePromptOptions = {},
): string {
  template = template.replace(LEGACY_TALKING_POINTS_SECTION, GUIDELINES_SECTION);
  let resolved = template;

  // Debug logging only if there's interesting data
  const hasLibraryElements = Object.keys(libraryElements).length > 0;
  const hasSelectedPaths = selectedPaths && Object.keys(selectedPaths).length > 0;
  const hasAiInsights = selectedAiInsights && Object.keys(selectedAiInsights).length > 0;

  if (hasLibraryElements || hasSelectedPaths || hasAiInsights) {
    console.log('=== Prompt Resolution ===');
    if (hasLibraryElements) console.log('Library elements:', Object.keys(libraryElements).join(', '));
    if (hasSelectedPaths) console.log('Selected paths:', JSON.stringify(selectedPaths));
    if (hasAiInsights) console.log('AI insights:', JSON.stringify(selectedAiInsights));
  }

  // Note: We no longer auto-inject context when templates don't reference {{idea}} or {{context}}.
  // Blueprint authors have full control over their prompts - if they don't include idea/context
  // variables, we respect that choice instead of force-injecting content.

  // Debug: Log slot values being used for resolution
  const videoVars = ['scene_count', 'video_duration', 'video_duration_minutes', 'scene_duration'];
  const hasVideoVars = videoVars.some(v => template.toLowerCase().includes(`{{${v}}}`));
  if (hasVideoVars) {
    console.log('[resolvePrompt] Template contains video vars, slotValues:', JSON.stringify(
      Object.fromEntries(videoVars.map(v => [v, slotValues[v]]))
    ));
  }

  // Library elements as the prompt sees them: combine mode uses the first item,
  // flattened product/ICP fields are rebuilt and filtered to the selected paths.
  const preparedElements: Record<string, any> = {};
  for (const [elementKey, elementValue] of Object.entries(libraryElements)) {
    let element = elementValue;
    if (Array.isArray(elementValue)) {
      console.log(`Element ${elementKey} is array (combine mode), using first item`);
      element = elementValue[0];
    }
    if (typeof element !== 'object' || element === null) continue;
    preparedElements[elementKey] = reconstructNestedFields(element, selectedPaths?.[elementKey]);
    console.log(`Reconstructed ${elementKey}:`, JSON.stringify(preparedElements[elementKey], null, 2));
  }

  console.log(`[resolvePrompt] AI data: ideaAiAnalysis type=${typeof ideaAiAnalysis}, present=${!!ideaAiAnalysis}, selectedAiInsights=${!!selectedAiInsights}`);
  const aiVars = resolveAiInsightVars(ideaAiAnalysis, selectedAiInsights as any);

  // {{#x}}...{{/x}} / {{^x}}...{{/x}} sections first, so an optional library
  // element that wasn't selected drops its whole line instead of leaving
  // "Highlight how  solves the problem." behind.
  resolved = renderPromptSections(resolved, (path) => {
    const dot = path.indexOf('.');
    if (dot < 0) {
      const slotKey = Object.keys(slotValues).find(k => k.toLowerCase() === path.toLowerCase());
      if (slotKey !== undefined) return slotValues[slotKey];
      if ((ALL_AI_VARS as readonly string[]).includes(path)) return aiVars[path as keyof typeof aiVars];
      // Bare library name: {{#product}} = "a product is selected"
      return Object.keys(preparedElements).find(k =>
        libraryPatterns(k).some(p => p.toLowerCase() === path.toLowerCase()));
    }
    const prefix = path.slice(0, dot).toLowerCase();
    const elementKey = Object.keys(preparedElements).find(k =>
      libraryPatterns(k).some(p => p.toLowerCase() === prefix));
    return elementKey ? getLibraryFieldValue(preparedElements[elementKey], path.slice(dot + 1)) : undefined;
  });

  // Replace text slots from idea (case-insensitive, allow optional spaces inside braces)
  for (const [key, value] of Object.entries(slotValues)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    const beforeReplace = resolved;
    resolved = resolved.replace(regex, value || '[Not provided]');
    // Log if a video config variable was replaced
    if (videoVars.includes(key) && beforeReplace !== resolved) {
      console.log(`[resolvePrompt] Replaced {{${key}}} with "${value}"`);
    }
  }

  // Replace library element references with selected paths
  for (const [elementKey, element] of Object.entries(preparedElements)) {
    // Process each pattern (shorthand, full table name and aliases)
    for (const pattern of libraryPatterns(elementKey)) {
      // Find all references to this element pattern in the template (case-insensitive, allow spaces inside braces)
      const elementRegex = new RegExp(`\\{\\{\\s*${pattern}\\.([^}]+?)\\s*\\}\\}`, 'gi');
      const matches = [...resolved.matchAll(elementRegex)];

      for (const match of matches) {
        const fullMatch = match[0];
        const fieldPath = match[1]; // e.g., "icp.jobTitles" or "name"

        console.log(`Resolving ${fullMatch} (pattern: ${pattern}) with path ${fieldPath}`);

        let value = getLibraryFieldValue(element, fieldPath);

        // Format arrays as comma-separated lists
        if (Array.isArray(value)) {
          value = value.join(', ');
        }

        console.log(`Resolved ${fullMatch} to: ${value}`);

        // Replace in prompt
        const regex = new RegExp(fullMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        resolved = resolved.replace(regex, String(value || '[Not provided]'));
      }
    }
  }

  // Helper: replace a mustache variable allowing optional whitespace inside braces
  const replaceVar = (varName: string, value: string) => {
    resolved = resolved.replace(new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`, 'gi'), value);
  };

  // Replace AI insights variables using unified resolver
  for (const varName of ALL_AI_VARS) {
    replaceVar(varName, aiVars[varName] || '');
  }

  // The idea's guidelines reach the writer even when the blueprint prompt
  // doesn't place them. Approved points are the owner's rules and always go in;
  // a prompt that lists the points itself only gets what it's missing. Ideas
  // nobody reviewed get the avoid list and the facts rule, not their AI-drafted
  // points, so blueprints that never used talking points don't start to.
  if (options.appendGuidelines && aiVars.ai_guidelines && !mentionsVar(template, ['ai_guidelines', 'ai_guardrails'])) {
    const listsPoints = mentionsVar(template, ['ai_talking_points', 'ai_talking_points_list', 'ai_talking_point']);
    let extra: string;
    let kind: string;
    if (listsPoints) {
      extra = aiVars.ai_guardrails;
      kind = 'guardrails';
    } else if (options.guidelinesApproved) {
      extra = aiVars.ai_guidelines;
      kind = 'approved guidelines';
    } else {
      const parsed = typeof ideaAiAnalysis === 'string' ? (() => { try { return JSON.parse(ideaAiAnalysis); } catch { return {}; } })() : ideaAiAnalysis;
      extra = guardrailsText(cleanList(parsed?.avoid));
      kind = 'guardrails (unreviewed points left out)';
    }
    if (extra) {
      resolved = `${resolved.trimEnd()}\n\n${extra}`;
      console.log(`[resolvePrompt] Appended idea ${kind} (template doesn't place them)`);
    }
  }

  // Warn and strip any remaining unresolved template variables instead of crashing
  const unresolvedMatches = resolved.match(/\{\{[^}]+\}\}/g);
  if (unresolvedMatches && unresolvedMatches.length > 0) {
    console.warn(`[resolvePrompt] Stripping unresolved template variables: ${unresolvedMatches.join(', ')}`);
    resolved = resolved.replace(/\{\{[^}]+\}\}/g, '');
  }

  console.log('=== Final Resolved Prompt ===');
  console.log(resolved);

  return resolved;
}
