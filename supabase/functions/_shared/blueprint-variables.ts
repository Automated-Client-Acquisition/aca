/**
 * The {{variables}} a blueprint prompt may use — the set the blueprint editor
 * offers (src/components/VariablesList.tsx) and the generation pipeline
 * resolves. Keep the two in sync: anything outside this list renders literally
 * in generated content (or gets stripped), so machine-written blueprints are
 * validated against it before they're saved.
 */

export const TEXT_VARIABLES: Record<string, string> = {
  topic: 'The idea title / subject of the new piece (always provided)',
  idea_text: 'Free text the user wrote on the idea',
  ai_hook: 'Primary hook from the idea analysis',
  ai_hook_type: 'Type of that hook (curiosity, contrarian, question, ...)',
  ai_hooks: 'All hooks as a numbered list',
  ai_cta: 'Primary call to action',
  ai_cta_type: 'CTA type (comment, follow, DM, link, ...)',
  ai_ctas: 'All CTAs as a numbered list',
  ai_talking_points: 'Key talking points as a bullet list',
  ai_talking_points_list: 'Talking points, comma separated',
  ai_guidelines: "The idea's guidelines: points to make, what not to mention, and the rule to only state facts from them",
  ai_guardrails: 'What not to mention plus the facts rule (for prompts that already list the talking points)',
  ai_avoid: 'Things the post must not mention, as a bullet list',
  ai_script_structure: 'Full script structure (opening/body/climax/closing)',
  ai_script_opening: 'Opening section guidance',
  ai_script_body: 'Body section guidance',
  ai_script_climax: 'Climax section guidance',
  ai_script_closing: 'Closing section guidance',
  ai_engagement_drivers: 'Engagement drivers as a bullet list',
  video_duration: 'Target video length in seconds (video only)',
  scene_count: 'Number of scenes (video only)',
  current_year: 'Current year',
  current_month: 'Current month name',
  current_date: 'Current date (YYYY-MM-DD)',
};

/** Library element fields: {{<shorthand>.<field>}}. */
export const LIBRARY_FIELDS: Record<string, string[]> = {
  brand: ['name', 'description', 'tone', 'style_guidelines', 'visual_style_description', 'mood_keywords'],
  character: ['name', 'description', 'speaking_style', 'overall_tone', 'expertise', 'visual_style', 'typical_clothing'],
  product: ['name', 'description', 'features', 'brand', 'category', 'price'],
  icp: ['name', 'description', 'pain_points', 'desires', 'language_style', 'objections'],
};

// Mirrors SHORTHAND_MAP in src/lib/blueprintUtils.ts
const LIBRARY_TABLE_BY_SHORTHAND: Record<string, string> = {
  brand: 'library_brand_voices',
  character: 'library_characters',
  product: 'library_products',
  icp: 'library_icps',
};

const LIBRARY_LABELS: Record<string, string> = {
  brand: 'Brand',
  character: 'Character',
  product: 'Product',
  icp: 'Target Audience',
};

const TOKEN_RE = /\{\{\s*([#^/]?)\s*([^}]*?)\s*\}\}/g;

export function isAllowedVariable(name: string): boolean {
  if (TEXT_VARIABLES[name]) return true;
  const [lib, field, ...rest] = name.split('.');
  return rest.length === 0 && !!field && !!LIBRARY_FIELDS[lib]?.includes(field);
}

/** Every {{token}} (or {{#section}} name) not in the allowlist. */
export function findUnknownVariables(...templates: (string | null | undefined)[]): string[] {
  const unknown = new Set<string>();
  for (const t of templates) {
    for (const m of (t || '').matchAll(TOKEN_RE)) {
      if (m[1] !== '/' && !isAllowedVariable(m[2])) unknown.add(`{{${m[1]}${m[2]}}}`);
    }
  }
  return [...unknown];
}

/**
 * Section tags whose open/close don't pair up. renderPromptSections leaves an
 * unpaired tag unprocessed, and resolvePrompt then strips it, so its body would
 * render unconditionally.
 */
export function findUnbalancedSections(...templates: (string | null | undefined)[]): string[] {
  const bad = new Set<string>();
  for (const t of templates) {
    const stack: { kind: string; name: string }[] = [];
    for (const m of (t || '').matchAll(TOKEN_RE)) {
      if (m[1] === '#' || m[1] === '^') stack.push({ kind: m[1], name: m[2] });
      else if (m[1] === '/') {
        if (stack[stack.length - 1]?.name === m[2]) stack.pop();
        else bad.add(`{{/${m[2]}}}`);
      }
    }
    stack.forEach(({ kind, name }) => bad.add(`{{${kind}${name}}}`));
  }
  return [...bad];
}

/** Mustache truthiness, minus iteration: empty strings/arrays/objects are falsy. */
function isSectionTruthy(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/**
 * Render {{#x}}...{{/x}} (kept when x is truthy) and {{^x}}...{{/x}} (kept
 * when x is falsy) sections. Only the tags go; the body's own {{vars}} are left
 * for plain substitution. Unlike full Mustache, an array section renders its
 * body once rather than per item — blueprint bodies reference the list itself
 * ("Pain points: {{icp.pain_points}}"). Nested sections resolve outside-in.
 */
export function renderPromptSections(template: string, lookup: (path: string) => unknown): string {
  const sectionRe = /\{\{\s*([#^])\s*([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\s*\/\s*\2\s*\}\}/g;
  let result = template;
  for (let i = 0; i < 10; i++) {
    const next = result.replace(sectionRe, (_, kind, path, body) =>
      (kind === '#') === isSectionTruthy(lookup(path)) ? body : '');
    if (next === result) break;
    result = next;
  }
  // A dropped section leaves its blank line behind.
  return result.replace(/\n{3,}/g, '\n\n');
}

/** `{idea}`-style single-brace placeholders — they never resolve. */
export function findSingleBracePlaceholders(...templates: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const t of templates) {
    const stripped = (t || '').replace(TOKEN_RE, '');
    for (const m of stripped.matchAll(/(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_.]*)\}(?!\})/g)) found.add(`{${m[1]}}`);
  }
  return [...found];
}

function formatLabel(key: string): string {
  return key.replace(/^ai_/, 'AI ').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * blueprints.structure.slots, derived the same way the editor does
 * (parsePromptSlots in src/lib/blueprintUtils.ts): one text slot per simple
 * variable, one library slot per referenced library. A slot is optional when
 * every reference to it sits inside a {{#x}}/{{^x}} section gated on itself
 * ("{{#product.name}}Mention {{product.name}}.{{/product.name}}").
 */
export function deriveSlots(...templates: (string | null | undefined)[]) {
  const slots = new Map<string, Record<string, unknown>>();
  for (const t of templates) {
    const open: string[] = [];
    for (const m of (t || '').matchAll(TOKEN_RE)) {
      const name = m[2];
      const [lib, field] = name.split('.');
      const isLibrary = !!field && !!LIBRARY_TABLE_BY_SHORTHAND[lib];
      if (field && !isLibrary) continue;
      const key = isLibrary ? lib : name;
      if (m[1] === '/') {
        if (open[open.length - 1] === key) open.pop();
        continue;
      }
      const required = !m[1] && !open.includes(key);
      if (m[1]) open.push(key);
      const existing = slots.get(key);
      if (existing) {
        existing.required = existing.required || required;
      } else if (isLibrary) {
        slots.set(key, {
          key,
          type: 'library_element',
          label: LIBRARY_LABELS[lib],
          library_table: LIBRARY_TABLE_BY_SHORTHAND[lib],
          required,
        });
      } else {
        slots.set(key, { key, type: 'text', label: formatLabel(name), required });
      }
    }
  }
  return [...slots.values()];
}

/** Prompt-ready reference of the allowlist. */
export function describeVariablesForPrompt(): string {
  const text = Object.entries(TEXT_VARIABLES).map(([k, d]) => `- {{${k}}} — ${d}`).join('\n');
  const libs = Object.entries(LIBRARY_FIELDS)
    .map(([lib, fields]) => `- ${LIBRARY_LABELS[lib]}: ${fields.map((f) => `{{${lib}.${f}}}`).join(', ')}`)
    .join('\n');
  return `IDEA / AI-INSIGHT VARIABLES (filled per generation):\n${text}\n\nLIBRARY VARIABLES (the user picks a brand / character / product / audience when generating):\n${libs}`;
}
