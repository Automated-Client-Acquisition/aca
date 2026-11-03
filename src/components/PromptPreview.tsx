import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PinnedLibraryElements } from "@/types/blueprint";
import { AI_INSIGHT_VARIABLES, AI_INSIGHT_DISPLAY_NAMES, resolveAiVarForPreview } from "@/lib/ai-insights";

interface PromptPreviewProps {
  prompt: string;
  className?: string;
  // Optional props for variable resolution tooltips
  ideaContext?: string;
  ideaFreeText?: string;
  pinnedLibraryElements?: PinnedLibraryElements;
  libraryData?: Record<string, any[]>;
  ideaAiAnalysis?: Record<string, any>;
  outputConfig?: Record<string, any> | null;
}

// Shorthand mapping for variable names (must match backend SHORTHAND_MAP)
const SHORTHAND_MAP: Record<string, string> = {
  'product': 'library_products',
  'brand': 'library_brand_voices',
  'brand_voice': 'library_brand_voices', // Legacy alias
  'character': 'library_characters',
  'block': 'library_blocks',
  'icp': 'library_icps',
  'identity': 'library_identities',
};

// Readable names for library tables
const TABLE_DISPLAY_NAMES: Record<string, string> = {
  'library_products': 'Product',
  'library_brand_voices': 'Brand',
  'library_characters': 'Character',
  'library_blocks': 'Block',
  'library_icps': 'ICP',
  'library_identities': 'Identity',
  'product': 'Product',
  'brand': 'Brand',
  'brand_voice': 'Brand', // Legacy alias
  'character': 'Character',
  'block': 'Block',
  'icp': 'ICP',
  'identity': 'Identity',
};

// AI insight variables, field maps, and display names imported from @/lib/ai-insights

// Video config variables (resolved at job dispatch time)
const VIDEO_CONFIG_VARIABLES = new Set([
  'scene_count',
  'video_duration',
  'video_duration_minutes',
  'scene_duration',
]);

const VIDEO_CONFIG_DISPLAY_NAMES: Record<string, string> = {
  'scene_count': 'Scene Count',
  'video_duration': 'Video Duration (seconds)',
  'video_duration_minutes': 'Video Duration (minutes)',
  'scene_duration': 'Scene Duration',
};

function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;

    // Handle array index access
    if (/^\d+$/.test(part)) {
      if (Array.isArray(current)) {
        current = current[parseInt(part, 10)];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }

  return current;
}

interface VariableResolution {
  value: string | null;
  source: string;
  status: 'resolved' | 'missing';
}

function resolveVariable(
  variable: string,
  ideaContext?: string,
  pinnedLibraryElements?: PinnedLibraryElements,
  libraryData?: Record<string, any[]>,
  ideaAiAnalysis?: Record<string, any>,
  outputConfig?: Record<string, any> | null,
  ideaFreeText?: string
): VariableResolution {
  // Remove all ? characters (could be at start or middle like product?.name)
  const cleanVar = variable.trim().replace(/\?/g, '');

  // Strip arithmetic expressions (e.g., "outputConfig.slideCount minus 1")
  const arithmeticMatch = cleanVar.match(/^(.+?)\s+(minus|plus)\s+(\d+)$/);
  const baseVar = arithmeticMatch ? arithmeticMatch[1].trim() : cleanVar;

  // Check for idea free text variable
  if (baseVar === 'idea_text') {
    if (ideaFreeText) {
      const truncated = ideaFreeText.length > 100
        ? ideaFreeText.substring(0, 100) + '...'
        : ideaFreeText;
      return { value: truncated, source: 'Idea free text', status: 'resolved' };
    }
    return { value: null, source: 'Add free text to idea', status: 'missing' };
  }

  // Check for idea-related variables (topic/idea/context/title/description all resolve to the same thing)
  if (['idea', 'context', 'title', 'description', 'topic'].includes(baseVar)) {
    if (ideaContext) {
      const truncated = ideaContext.length > 100
        ? ideaContext.substring(0, 100) + '...'
        : ideaContext;
      return { value: truncated, source: 'Idea', status: 'resolved' };
    }
    return { value: null, source: 'Add an idea', status: 'missing' };
  }

  // Check for video config variables (resolved at dispatch time)
  if (VIDEO_CONFIG_VARIABLES.has(cleanVar)) {
    const displayName = VIDEO_CONFIG_DISPLAY_NAMES[cleanVar] || cleanVar;
    return { value: '[From video config]', source: displayName, status: 'resolved' };
  }

  // Check for AI insight variables
  if (AI_INSIGHT_VARIABLES.has(cleanVar)) {
    return resolveAiVarForPreview(cleanVar, ideaAiAnalysis);
  }

  // Check for system config variables (resolved at generation time, not in editor)
  const SYSTEM_CONFIG_PREFIXES = ['outputConfig', 'previousStageOutputs', 'brandVoice'];
  const dotIndex = baseVar.indexOf('.');
  if (dotIndex > 0) {
    const prefix = baseVar.substring(0, dotIndex);
    if (SYSTEM_CONFIG_PREFIXES.includes(prefix)) {
      const fieldName = baseVar.substring(dotIndex + 1);
      const displayNames: Record<string, string> = {
        slideCount: 'Slide Count',
        ctaButtonText: 'CTA Button Text',
        sceneCount: 'Scene Count',
        aspectRatio: 'Aspect Ratio',
        stylePreset: 'Style Preset',
      };
      // If outputConfig is provided and has the actual value, show it (with arithmetic)
      if (prefix === 'outputConfig' && outputConfig && outputConfig[fieldName] !== undefined && outputConfig[fieldName] !== null && outputConfig[fieldName] !== '') {
        let displayValue = String(outputConfig[fieldName]);
        if (arithmeticMatch) {
          const numValue = Number(outputConfig[fieldName]);
          if (!isNaN(numValue)) {
            const operand = parseInt(arithmeticMatch[3], 10);
            const result = arithmeticMatch[2] === 'minus' ? numValue - operand : numValue + operand;
            displayValue = String(result);
          }
        }
        return { value: displayValue, source: displayNames[fieldName] || fieldName, status: 'resolved' };
      }
      return { value: '[Set in blueprint config]', source: displayNames[fieldName] || fieldName, status: 'resolved' };
    }
  }

  // Check for library element fields (e.g., product.name, library_products.name)
  if (dotIndex > 0) {
    const tableName = baseVar.substring(0, dotIndex);
    const fieldPath = baseVar.substring(dotIndex + 1);

    // Map shorthand to full table name
    const fullTableName = SHORTHAND_MAP[tableName] || tableName;
    const displayName = TABLE_DISPLAY_NAMES[tableName] || tableName;

    // Check if we have pinned elements and library data
    if (pinnedLibraryElements && libraryData) {
      const config = pinnedLibraryElements[fullTableName];
      if (config) {
        const elementIds = Object.keys(config.elements);
        if (elementIds.length > 0) {
          const elements = libraryData[fullTableName] || [];
          const firstElement = elements.find(el => elementIds.includes(el.id));

          if (firstElement) {
            const value = getNestedValue(firstElement, fieldPath);
            if (value !== undefined && value !== null) {
              const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
              const truncated = stringValue.length > 100
                ? stringValue.substring(0, 100) + '...'
                : stringValue;
              const elementName = firstElement.name || firstElement.title || '';
              return {
                value: truncated,
                source: elementName ? `${displayName}: ${elementName}` : displayName,
                status: 'resolved'
              };
            }
            // Element selected but field is empty
            const elementName = firstElement.name || firstElement.title || '';
            return {
              value: null,
              source: `Field "${fieldPath}" empty on ${elementName || displayName}`,
              status: 'missing'
            };
          }
        }
      }
      // No element selected for this table
      return { value: null, source: `Select a ${displayName}`, status: 'missing' };
    }

    return { value: null, source: `Select a ${displayName}`, status: 'missing' };
  }

  // Check for date/time variables
  const DATE_RESOLVERS: Record<string, () => string> = {
    'date': () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    'current_year': () => String(new Date().getFullYear()),
    'current_month': () => new Date().toLocaleString('en-US', { month: 'long' }),
    'current_month_short': () => new Date().toLocaleString('en-US', { month: 'short' }),
    'current_month_number': () => String(new Date().getMonth() + 1).padStart(2, '0'),
    'current_date': () => new Date().toISOString().split('T')[0],
    'current_quarter': () => `Q${Math.ceil((new Date().getMonth() + 1) / 3)}`,
  };
  if (DATE_RESOLVERS[baseVar]) {
    return { value: DATE_RESOLVERS[baseVar](), source: 'Current date/time', status: 'resolved' };
  }

  // Unknown variable
  return { value: null, source: 'Unknown variable', status: 'missing' };
}

export function PromptPreview({
  prompt,
  className = "",
  ideaContext,
  ideaFreeText,
  pinnedLibraryElements,
  libraryData,
  ideaAiAnalysis,
  outputConfig,
}: PromptPreviewProps) {
  // Parse prompt and highlight variables
  const parts = prompt.split(/({{[^}]+}})/g);

  // Check if we have resolution context
  const hasResolutionContext = ideaContext !== undefined || ideaFreeText !== undefined || pinnedLibraryElements !== undefined || ideaAiAnalysis !== undefined;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={`font-mono text-sm whitespace-pre-wrap break-words ${className}`}>
        {parts.map((part, index) => {
          if (part.startsWith("{{") && part.endsWith("}}")) {
            const variable = part.slice(2, -2).trim();

            // Skip Mustache block tags (conditionals) — these are control flow, not variables
            if (variable.startsWith('#') || variable.startsWith('^') || variable.startsWith('/')) {
              return null; // Hide Mustache control tags from preview
            }

            // If we have resolution context, show tooltip
            if (hasResolutionContext) {
              const resolution = resolveVariable(
                variable,
                ideaContext,
                pinnedLibraryElements,
                libraryData,
                ideaAiAnalysis,
                outputConfig,
                ideaFreeText
              );

              // Check if variable is optional (contains ?) and clean up for display
              const trimmedVar = variable.trim();
              const isOptional = trimmedVar.includes('?');
              // Remove all ? from display (could be at start like ?product.name or middle like product?.name)
              const displayVariable = trimmedVar.replace(/\?/g, '');

              return (
                <Tooltip key={index}>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="secondary"
                      className={`mx-0.5 font-mono text-xs cursor-help ${
                        resolution.status === 'resolved'
                          ? 'bg-green-500/10 text-green-700 hover:bg-green-500/20 border-green-500/20'
                          : isOptional
                            ? 'bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 border-blue-500/20'
                            : 'bg-yellow-500/10 text-yellow-700 hover:bg-yellow-500/20 border-yellow-500/20'
                      }`}
                    >
                      {displayVariable}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-xs"
                  >
                    <div className="space-y-1">
                      {resolution.status === 'resolved' ? (
                        <>
                          <div className="text-xs font-medium text-green-600">→ "{resolution.value}"</div>
                          <div className="text-xs text-muted-foreground">Source: {resolution.source}</div>
                        </>
                      ) : isOptional ? (
                        <>
                          <div className="text-xs font-medium text-blue-600">Optional - will be skipped</div>
                          <div className="text-xs text-muted-foreground">{resolution.source}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-medium text-yellow-600">⚠️ Not provided</div>
                          <div className="text-xs text-muted-foreground">{resolution.source}</div>
                        </>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            }

            // No resolution context, show simple badge
            return (
              <Badge
                key={index}
                variant="secondary"
                className="mx-0.5 font-mono text-xs bg-primary/10 text-primary hover:bg-primary/20 border-primary/20"
              >
                {variable}
              </Badge>
            );
          }
          return <span key={index}>{part}</span>;
        })}
      </div>
    </TooltipProvider>
  );
}

// Extract unique variables from a prompt
export function extractVariables(prompt: string): string[] {
  const matches = prompt.match(/{{([^}]+)}}/g) || [];
  const variables = matches.map(match => match.slice(2, -2));
  return Array.from(new Set(variables));
}
