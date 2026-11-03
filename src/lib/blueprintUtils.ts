import type { Blueprint, BlueprintSlot, LibraryElementType } from "@/types/blueprint";

const LIBRARY_TABLES: LibraryElementType[] = [
  'library_brand_voices',
  'library_characters',
  'library_blocks',
  'library_products',
  'library_icps',
];

// Map shorthand names to full library table names
const SHORTHAND_MAP: Record<string, LibraryElementType | string> = {
  'product': 'library_products',
  'brand': 'library_brand_voices',
  'brand_voice': 'library_brand_voices', // Legacy alias
  'character': 'library_characters',
  'block': 'library_blocks',
  'icp': 'library_icps',
  'identity': 'library_identities',
};

/**
 * Convert technical field names to business-friendly labels
 */
export function formatFieldLabel(key: string): string {
  const labelMap: Record<string, string> = {
    'icp': 'Target Audience',
    'painPoints': 'Pain Points',
    'pain_points': 'Pain Points',
    'jobTitles': 'Job Titles',
    'job_titles': 'Job Titles',
    'ageRange': 'Age Range',
    'age_range': 'Age Range',
    'gender': 'Gender',
    'income': 'Income Level',
    'location': 'Location',
    'demographics': 'Demographics (deprecated)',
    'psychographics': 'Psychographics',
    'desires': 'Desires',
    'buyingMotivations': 'Buying Motivations',
    'buying_motivations': 'Buying Motivations',
    'buyingBehavior': 'Buying Behavior',
    'buying_behavior': 'Buying Behavior',
    'marketing_angles': 'Marketing Angles',
    'marketingAngles': 'Marketing Angles',
    'hooks': 'Hooks',
    'frameworks': 'Frameworks',
    'brand_voice': 'Brand Voice',
    'brandVoice': 'Brand Voice',
    'tone': 'Tone',
    'style_guidelines': 'Style Guidelines',
    'styleGuidelines': 'Style Guidelines',
    'character': 'Character',
    'personality': 'Personality',
    'visual_style': 'Visual Style',
    'visualStyle': 'Visual Style',
    'voice_config': 'Voice Configuration',
    'voiceConfig': 'Voice Configuration',
    'product': 'Product',
    'name': 'Name',
    'category': 'Category',
    'benefits': 'Benefits',
    'features': 'Features',
    'price': 'Price',
    'description': 'Description',
    'content_angle': 'Content Angle',
    'contentAngle': 'Content Angle',
  };

  return key
    .split('.')
    .map(part => {
      // First check the label map
      if (labelMap[part]) return labelMap[part];
      
      // Convert snake_case to Title Case
      if (part.includes('_')) {
        return part.split('_').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        ).join(' ');
      }
      
      // Convert camelCase to Title Case
      return part
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    })
    .join(' › ');
}

/**
 * Parse slots from a prompt string by detecting {{variable}} patterns
 * Supports both simple variables ({{topic}}) and library element fields ({{product.name}} or {{library_products.name}})
 * Deduplicates library element slots - multiple references to same library table create single slot
 * A slot is optional when marked {{?variable}} or when every reference sits inside a
 * {{#x}}/{{^x}} section gated on that same slot, e.g.
 * {{#product.name}}Highlight {{product.name}}.{{/product.name}} (dispatch-generation-job
 * drops the section when no product is selected). Mirrors deriveSlots in
 * supabase/functions/_shared/blueprint-variables.ts.
 */
export function parsePromptSlots(prompt: string): BlueprintSlot[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = Array.from(prompt.matchAll(regex));
  const uniqueVars = new Map<string, BlueprintSlot>();
  const slotByTable = new Map<string, BlueprintSlot>();
  const openSections: string[] = [];

  matches.forEach((match) => {
    let key = match[1].trim();

    // Section tags: {{#x}} / {{^x}} open, {{/x}} closes
    const sectionMarker = /^[#^/]/.test(key) ? key[0] : null;
    if (sectionMarker) key = key.substring(1).trim();

    // Detect optional syntax: {{?variable}}
    const isOptional = key.startsWith('?');
    const cleanKey = isOptional ? key.substring(1).trim() : key;

    // Check if this is a library element field reference (e.g., product.name or library_products.name)
    const dotIndex = cleanKey.indexOf('.');
    const isLibraryField = dotIndex > 0;
    const tableName = isLibraryField ? cleanKey.substring(0, dotIndex) : null;

    // Check if it's a shorthand name (e.g., "product") or full table name (e.g., "library_products")
    const mappedTableName = tableName && SHORTHAND_MAP[tableName] ? SHORTHAND_MAP[tableName] : tableName;
    const isValidLibraryTable = mappedTableName && LIBRARY_TABLES.includes(mappedTableName as LibraryElementType);

    if (isLibraryField && !isValidLibraryTable) return;
    const slotId = isValidLibraryTable ? mappedTableName! : cleanKey;

    if (sectionMarker === '/') {
      if (openSections[openSections.length - 1] === slotId) openSections.pop();
      return;
    }
    const required = !sectionMarker && !isOptional && !openSections.includes(slotId);
    if (sectionMarker) openSections.push(slotId);

    if (isValidLibraryTable) {
      // For library elements, use the base table name as the key (deduplicate)
      // e.g., product.name, product.category → single "product" slot
      const existing = slotByTable.get(mappedTableName!);
      if (existing) {
        existing.required = existing.required || required;
      } else {
        const slot: BlueprintSlot = {
          key: tableName!,
          type: 'library_element',
          label: formatFieldLabel(tableName!),
          library_table: mappedTableName as LibraryElementType,
          required,
        };
        slotByTable.set(mappedTableName!, slot);
        uniqueVars.set(tableName!, slot);
      }
    } else {
      // Simple text slots
      const existing = uniqueVars.get(cleanKey);
      if (existing) {
        existing.required = existing.required || required;
      } else {
        uniqueVars.set(cleanKey, {
          key: cleanKey,
          type: 'text',
          label: formatFieldLabel(cleanKey),
          required,
        });
      }
    }
  });

  return Array.from(uniqueVars.values());
}

/**
 * Extract which specific fields are referenced in a blueprint's master prompt
 * for a given library table (e.g., product.icp_pain_points, product.name)
 */
export function extractUsedFields(prompt: string, libraryTable: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = Array.from(prompt.matchAll(regex));
  const fields = new Set<string>();

  // Map shorthand to full table name
  const tableName = SHORTHAND_MAP[libraryTable] || libraryTable;
  const shorthandName = Object.keys(SHORTHAND_MAP).find(k => SHORTHAND_MAP[k] === tableName) || libraryTable;

  matches.forEach((match) => {
    const key = match[1].trim().replace(/^\?/, ''); // Remove optional marker
    const dotIndex = key.indexOf('.');

    if (dotIndex > 0) {
      const tableRef = key.substring(0, dotIndex);
      const fieldName = key.substring(dotIndex + 1);

      // Check if this reference matches our library table (shorthand or full name)
      if (tableRef === shorthandName || tableRef === libraryTable || tableRef === tableName) {
        fields.add(fieldName);
      }
    }
  });

  return Array.from(fields);
}

/**
 * Parse slots from all prompt templates (master, image, director)
 * This ensures library elements referenced in any prompt are detected
 */
export function parseAllPromptSlots(masterPrompt: string, imagePrompt?: string, directorPrompt?: string): BlueprintSlot[] {
  const parts = [masterPrompt, imagePrompt, directorPrompt].filter(Boolean);
  return parsePromptSlots(parts.join('\n'));
}

/**
 * Which library tables a blueprint needs: from prompt variables AND
 * reference_image_libraries (e.g. Images has no prompt-variable field, so it
 * only surfaces via the latter). Shared by the manual generation wizard and
 * Autopilot so both agree on when a library picker should even appear.
 */
export function getRequiredLibraryTables(blueprint: Pick<Blueprint, 'master_prompt' | 'image_prompt' | 'director_prompt' | 'reference_image_libraries'> | undefined): string[] {
  if (!blueprint) return [];
  const slots = parseAllPromptSlots(blueprint.master_prompt || '', blueprint.image_prompt, blueprint.director_prompt);
  const tables = new Set<string>();
  slots.forEach(slot => {
    if (slot.library_table) tables.add(slot.library_table);
  });
  (blueprint.reference_image_libraries || []).forEach(table => tables.add(table));
  return Array.from(tables);
}

/**
 * Extract used fields from all prompt templates
 */
export function extractAllUsedFields(
  masterPrompt: string,
  imagePrompt: string | undefined,
  libraryTable: string,
  directorPrompt?: string
): string[] {
  const allFields = [masterPrompt, imagePrompt, directorPrompt]
    .filter(Boolean)
    .flatMap(prompt => extractUsedFields(prompt!, libraryTable));
  return [...new Set(allFields)];
}

// AI insight variable categories for UX display
export const AI_VARIABLE_CATEGORIES = {
  hooks: ['ai_hook', 'ai_hook_type', 'ai_hooks', 'ai_hooks_list'],
  talking_points: ['ai_talking_points', 'ai_talking_points_list', 'ai_talking_point'],
  ctas: ['ai_cta', 'ai_cta_type', 'ai_cta_placement', 'ai_ctas', 'ai_ctas_list'],
  script_structure: ['ai_script_structure', 'ai_script_opening', 'ai_script_body', 'ai_script_climax', 'ai_script_closing'],
  engagement: ['ai_engagement_drivers', 'ai_engagement_drivers_list'],
} as const;

// All AI insight variables as a flat set
export const ALL_AI_VARIABLES: Set<string> = new Set([
  ...AI_VARIABLE_CATEGORIES.hooks,
  ...AI_VARIABLE_CATEGORIES.talking_points,
  ...AI_VARIABLE_CATEGORIES.ctas,
  ...AI_VARIABLE_CATEGORIES.script_structure,
  ...AI_VARIABLE_CATEGORIES.engagement,
]);

// Idea-related variables (always available when an idea is selected)
export const IDEA_VARIABLES = new Set(['idea', 'context', 'title', 'description', 'topic']);

export interface ExtractedVariables {
  all: string[];
  idea: string[];
  ai: string[];
  library: string[];
  aiCategories: {
    hooks: boolean;
    talking_points: boolean;
    ctas: boolean;
    script_structure: boolean;
    engagement: boolean;
  };
}

/**
 * Extract all variables from a prompt template, categorized by type.
 * This is useful for showing users which variables a template uses.
 */
export function extractPromptVariables(prompt: string): ExtractedVariables {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = Array.from(prompt.matchAll(regex));
  const variables = new Set<string>();

  matches.forEach(match => {
    const variable = match[1].trim().replace(/^\?/, '');
    variables.add(variable);
  });

  const all = Array.from(variables);
  const idea: string[] = [];
  const ai: string[] = [];
  const library: string[] = [];

  all.forEach(variable => {
    if (IDEA_VARIABLES.has(variable)) {
      idea.push(variable);
    } else if (ALL_AI_VARIABLES.has(variable)) {
      ai.push(variable);
    } else if (variable.includes('.')) {
      library.push(variable);
    }
  });

  // Determine which AI categories are used
  const aiCategories = {
    hooks: AI_VARIABLE_CATEGORIES.hooks.some(v => variables.has(v)),
    talking_points: AI_VARIABLE_CATEGORIES.talking_points.some(v => variables.has(v)),
    ctas: AI_VARIABLE_CATEGORIES.ctas.some(v => variables.has(v)),
    script_structure: AI_VARIABLE_CATEGORIES.script_structure.some(v => variables.has(v)),
    engagement: AI_VARIABLE_CATEGORIES.engagement.some(v => variables.has(v)),
  };

  return { all, idea, ai, library, aiCategories };
}

/**
 * Check if a prompt template uses any talking point variables
 */
export function promptUsesTalkingPoints(prompt: string): boolean {
  const { aiCategories } = extractPromptVariables(prompt);
  return aiCategories.talking_points;
}

/**
 * Check if a prompt template uses any hook variables
 */
export function promptUsesHooks(prompt: string): boolean {
  const { aiCategories } = extractPromptVariables(prompt);
  return aiCategories.hooks;
}

/**
 * Check if a prompt template uses any CTA variables
 */
export function promptUsesCtas(prompt: string): boolean {
  const { aiCategories } = extractPromptVariables(prompt);
  return aiCategories.ctas;
}

/**
 * Get a human-readable summary of which AI insights a prompt uses
 */
export function getAiInsightsSummary(prompt: string): string[] {
  const { aiCategories } = extractPromptVariables(prompt);
  const summary: string[] = [];

  if (aiCategories.hooks) summary.push('Hooks');
  if (aiCategories.talking_points) summary.push('Talking Points');
  if (aiCategories.ctas) summary.push('CTAs');
  if (aiCategories.script_structure) summary.push('Script Structure');
  if (aiCategories.engagement) summary.push('Engagement Drivers');

  return summary;
}

/**
 * Check if a blueprint's prompts reference idea-related or AI insight variables.
 * When they don't, the Ideas step can be skipped (e.g., in recording mode).
 */
export function blueprintNeedsIdeas(
  masterPrompt: string,
  imagePrompt?: string,
  directorPrompt?: string
): boolean {
  const all = [masterPrompt, imagePrompt, directorPrompt].filter(Boolean).join('\n');
  const { idea, ai } = extractPromptVariables(all);
  return idea.length > 0 || ai.length > 0;
}
