/**
 * PromptBuilder
 *
 * Handles template rendering for stage prompts.
 * Uses a simple Mustache-like syntax: {{variable}}, {{#conditional}}...{{/conditional}}
 */

import type { ExecutionContext, PromptTemplate } from '../execution/types.ts';
import { getContextValue } from '../execution/ExecutionContext.ts';

/**
 * Rendered prompt result.
 */
export interface RenderedPrompt {
  system: string;
  user: string;
}

/**
 * Render a prompt template with context values.
 */
export function renderPromptTemplate(
  template: PromptTemplate,
  context: ExecutionContext
): RenderedPrompt {
  return {
    system: renderTemplate(template.system, context),
    user: renderTemplate(template.user, context),
  };
}

/**
 * Render a single template string with context values.
 *
 * Supports:
 * - {{variable}} - Simple variable substitution
 * - {{nested.path}} - Nested property access
 * - {{#condition}}content{{/condition}} - Conditional blocks (renders if truthy)
 * - {{^condition}}content{{/condition}} - Inverted blocks (renders if falsy)
 * - {{#array}}...{{/array}} - Array iteration (uses {{.}} for current item)
 */
export function renderTemplate(template: string, context: ExecutionContext): string {
  if (!template) return '';

  let result = template;

  // Process conditional blocks first: {{#condition}}...{{/condition}}
  result = processConditionalBlocks(result, context);

  // Process inverted blocks: {{^condition}}...{{/condition}}
  result = processInvertedBlocks(result, context);

  // Process array blocks: {{#array}}...{{/array}}
  result = processArrayBlocks(result, context);

  // Process simple variable substitutions: {{variable}}
  result = processVariables(result, context);

  // Clean up any remaining empty lines from conditionals
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

/**
 * Process conditional blocks: {{#condition}}content{{/condition}}
 */
function processConditionalBlocks(template: string, context: ExecutionContext): string {
  // Match {{#path}}content{{/path}} (allow optional whitespace inside braces)
  const blockRegex = /\{\{\s*#([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\s*\/\1\s*\}\}/g;

  return template.replace(blockRegex, (_, path, content) => {
    const value = getContextValue(context, path);

    // Check if value is truthy
    if (isTruthy(value)) {
      // If it's an object, use it as sub-context for nested templates
      if (typeof value === 'object' && !Array.isArray(value)) {
        return renderWithSubContext(content, context, value);
      }
      return content;
    }

    return '';
  });
}

/**
 * Process inverted blocks: {{^condition}}content{{/condition}}
 */
function processInvertedBlocks(template: string, context: ExecutionContext): string {
  // Match {{^path}}content{{/path}} (allow optional whitespace inside braces)
  const blockRegex = /\{\{\s*\^([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\s*\/\1\s*\}\}/g;

  return template.replace(blockRegex, (_, path, content) => {
    const value = getContextValue(context, path);

    // Render if value is falsy
    if (!isTruthy(value)) {
      return content;
    }

    return '';
  });
}

/**
 * Process array blocks: {{#array}}...{{.}}...{{/array}}
 */
function processArrayBlocks(template: string, context: ExecutionContext): string {
  // Match {{#path}}content{{/path}} where path resolves to an array (allow optional whitespace)
  const blockRegex = /\{\{\s*#([a-zA-Z0-9_.]+)\s*\}\}([\s\S]*?)\{\{\s*\/\1\s*\}\}/g;

  return template.replace(blockRegex, (match, path, content) => {
    const value = getContextValue(context, path);

    // Only process if it's an array
    if (Array.isArray(value)) {
      return value
        .map((item, index) => {
          let itemContent = content;

          // Replace {{.}} with current item (allow spaces)
          itemContent = itemContent.replace(/\{\{\s*\.\s*\}\}/g, String(item));

          // Replace {{@index}} with current index (allow spaces)
          itemContent = itemContent.replace(/\{\{\s*@index\s*\}\}/g, String(index));

          // If item is an object, allow {{property}} access (case-insensitive, allow spaces)
          if (typeof item === 'object' && item !== null) {
            Object.keys(item).forEach((key) => {
              const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
              itemContent = itemContent.replace(regex, String(item[key] ?? ''));
            });
          }

          return itemContent;
        })
        .join('');
    }

    // If not an array but already processed as conditional, return original match
    return match;
  });
}

/**
 * Process simple variable substitutions: {{variable}} and {{nested.path}}
 * Also supports arithmetic: {{variable minus N}} and {{variable plus N}}
 */
function processVariables(template: string, context: ExecutionContext): string {
  // Match {{path}} or {{path minus N}} / {{path plus N}}, but not {{#path}} or {{/path}} or {{^path}}
  // Allow optional whitespace inside braces: {{ path }} works like {{path}}
  const variableRegex = /\{\{\s*([^#/^][a-zA-Z0-9_.]*(?:\s+(?:minus|plus)\s+\d+)?)\s*\}\}/g;

  return template.replace(variableRegex, (_, rawPath) => {
    // Check for arithmetic expression
    const arithmeticMatch = rawPath.match(/^(.+?)\s+(minus|plus)\s+(\d+)$/);
    const path = arithmeticMatch ? arithmeticMatch[1].trim() : rawPath;

    const value = getContextValue(context, path);

    if (value === undefined || value === null) {
      return '';
    }

    // Apply arithmetic if present
    if (arithmeticMatch) {
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        const operand = parseInt(arithmeticMatch[3], 10);
        const result = arithmeticMatch[2] === 'minus' ? numValue - operand : numValue + operand;
        return String(result);
      }
    }

    if (typeof value === 'object') {
      // For objects, stringify them
      return JSON.stringify(value);
    }

    return String(value);
  });
}

/**
 * Render template with a sub-context merged in.
 */
function renderWithSubContext(
  template: string,
  context: ExecutionContext,
  subContext: Record<string, any>
): string {
  // Create a merged context for variable resolution
  // Sub-context values take precedence for direct property access
  const mergedContext = { ...context, ...subContext } as ExecutionContext;

  // Process the content with the merged context
  let result = template;

  // Process nested conditionals
  result = processConditionalBlocks(result, mergedContext);
  result = processInvertedBlocks(result, mergedContext);

  // Process variables - check sub-context first (supports arithmetic: {{var minus N}})
  const variableRegex = /\{\{([^#/^][a-zA-Z0-9_.]*(?:\s+(?:minus|plus)\s+\d+)?)\}\}/g;
  result = result.replace(variableRegex, (_, rawPath) => {
    const arithmeticMatch = rawPath.match(/^(.+?)\s+(minus|plus)\s+(\d+)$/);
    const path = arithmeticMatch ? arithmeticMatch[1].trim() : rawPath;

    let value: any;
    // Check sub-context first for direct properties
    if (!path.includes('.') && subContext[path] !== undefined) {
      value = subContext[path];
    } else {
      // Fall back to full context
      value = getContextValue(mergedContext, path);
    }

    if (value === undefined || value === null) return '';

    // Apply arithmetic if present
    if (arithmeticMatch) {
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        const operand = parseInt(arithmeticMatch[3], 10);
        const result = arithmeticMatch[2] === 'minus' ? numValue - operand : numValue + operand;
        return String(result);
      }
    }

    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });

  return result;
}

/**
 * Check if a value is truthy for template conditionals.
 */
function isTruthy(value: any): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return false;
  }

  if (Array.isArray(value) && value.length === 0) {
    return false;
  }

  if (typeof value === 'object' && Object.keys(value).length === 0) {
    return false;
  }

  return true;
}

/**
 * Extract all variables used in a template.
 * Useful for validation and debugging.
 */
export function extractTemplateVariables(template: string): string[] {
  const variables = new Set<string>();

  // Match all variable patterns
  const patterns = [
    /\{\{([^#/^}][a-zA-Z0-9_.]*)\}\}/g, // Simple variables
    /\{\{#([a-zA-Z0-9_.]+)\}\}/g, // Conditional blocks
    /\{\{\^([a-zA-Z0-9_.]+)\}\}/g, // Inverted blocks
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
  }

  return Array.from(variables);
}

/**
 * Validate that all required variables are present in context.
 */
export function validateTemplateVariables(
  template: string,
  context: ExecutionContext
): { valid: boolean; missing: string[] } {
  const variables = extractTemplateVariables(template);
  const missing: string[] = [];

  for (const variable of variables) {
    const value = getContextValue(context, variable);
    if (value === undefined) {
      missing.push(variable);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Common prompt building helpers.
 */
export const PromptHelpers = {
  /**
   * Build a list of bullet points from an array.
   */
  bulletList(items: string[], prefix = '- '): string {
    return items.map((item) => `${prefix}${item}`).join('\n');
  },

  /**
   * Build a numbered list from an array.
   */
  numberedList(items: string[]): string {
    return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
  },

  /**
   * Truncate text to a maximum length.
   */
  truncate(text: string, maxLength: number, suffix = '...'): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - suffix.length) + suffix;
  },

  /**
   * Clean up text for use in prompts.
   */
  cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  /**
   * Format brand voice context for prompts.
   */
  formatBrandVoice(brandVoice: any): string {
    if (!brandVoice) return '';

    const parts: string[] = [];

    if (brandVoice.name) {
      parts.push(`Brand: ${brandVoice.name}`);
    }
    if (brandVoice.tone) {
      parts.push(`Tone: ${brandVoice.tone}`);
    }
    if (brandVoice.writingStyle) {
      parts.push(`Writing Style: ${brandVoice.writingStyle}`);
    }
    if (brandVoice.vocabulary?.length) {
      parts.push(`Key Terms: ${brandVoice.vocabulary.join(', ')}`);
    }

    return parts.join('\n');
  },

  /**
   * Format character context for prompts.
   */
  formatCharacter(character: any): string {
    if (!character) return '';

    const parts: string[] = [];

    if (character.name) {
      parts.push(`Character: ${character.name}`);
    }
    if (character.description) {
      parts.push(`Description: ${character.description}`);
    }
    if (character.personality) {
      parts.push(`Personality: ${character.personality}`);
    }
    if (character.visualDescription) {
      parts.push(`Visual: ${character.visualDescription}`);
    }

    return parts.join('\n');
  },

  /**
   * Format product context for prompts.
   */
  formatProduct(product: any): string {
    if (!product) return '';

    const parts: string[] = [];

    if (product.name) {
      parts.push(`Product: ${product.name}`);
    }
    if (product.description) {
      parts.push(`Description: ${product.description}`);
    }
    if (product.features?.length) {
      parts.push(`Features: ${product.features.join(', ')}`);
    }
    if (product.benefits?.length) {
      parts.push(`Benefits: ${product.benefits.join(', ')}`);
    }

    return parts.join('\n');
  },
};
