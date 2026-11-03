import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Eye, AlertTriangle, Sparkles } from "lucide-react";
import { ManualIdeaRow } from "@/types/generation";
import { PinnedLibraryElements } from "@/types/blueprint";
import { VideoConfig } from "@/types/wizard";
import { cn } from "@/lib/utils";
import { AI_INSIGHT_VARIABLES, resolveAiVarForPrompt } from "@/lib/ai-insights";

interface ResolvedPromptPreviewProps {
  promptTemplate: string;
  ideaRows: ManualIdeaRow[];
  pinnedLibraryElements: PinnedLibraryElements;
  libraryData: Record<string, any[]>;
  ideaAiAnalysis?: Record<string, any>;
  videoConfig?: VideoConfig | null;
  outputConfig?: Record<string, any> | null;
  maxSamples?: number;
  className?: string;
  title?: string;
}

interface ResolvedVariable {
  variable: string;
  value: string | null;
  isMissing: boolean;
}

interface PromptSample {
  ideaTitle: string;
  libraryContext: string;
  resolvedPrompt: string;
  variables: ResolvedVariable[];
  missingCount: number;
}

// Shorthand mapping for variable names
const SHORTHAND_MAP: Record<string, string> = {
  'product': 'library_products',
  'brand': 'library_brand_voices',
  'brand_voice': 'library_brand_voices', // Legacy alias
  'character': 'library_characters',
  'block': 'library_blocks',
  'icp': 'library_icps',
  'identity': 'library_identities',
};

// AI insight variables imported from shared utility

// Video config variables (resolved at job dispatch time with actual values)
// Note: scene_count and scene_duration are now calculated automatically from voiceover duration
const VIDEO_CONFIG_VARIABLES = new Set([
  'scene_count',
  'video_duration',
  'video_duration_minutes',
  'scene_duration',
]);

// AI_INSIGHT_FIELD_MAP removed — resolution now handled by shared utility

function resolvePromptWithData(
  prompt: string,
  idea: ManualIdeaRow,
  libraryElements: Record<string, any>,
  aiAnalysis?: Record<string, any>,
  videoConfig?: VideoConfig | null,
  outputConfig?: Record<string, any> | null
): { resolved: string; variables: ResolvedVariable[] } {
  const variables: ResolvedVariable[] = [];

  let resolved = prompt.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
    const trimmedVar = variable.trim();
    // Skip Mustache block tags (conditionals) — strip them from output
    if (trimmedVar.startsWith('#') || trimmedVar.startsWith('^') || trimmedVar.startsWith('/')) {
      return '';
    }
    const cleanVar = trimmedVar.replace(/^\?/, '');

    // Check for idea free text variable
    if (cleanVar === 'idea_text') {
      const value = idea.freeText || null;
      variables.push({ variable: cleanVar, value, isMissing: !value });
      return value || `⚠️ [Not provided: ${cleanVar}]`;
    }

    // Check for idea-related variables
    if (['idea', 'context', 'title', 'description', 'topic', 'idea_title'].includes(cleanVar)) {
      const value = idea.context;
      variables.push({ variable: cleanVar, value, isMissing: false });
      return value;
    }

    // Check for date variables
    const DATE_RESOLVERS: Record<string, () => string> = {
      'date': () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      'current_year': () => String(new Date().getFullYear()),
      'current_month': () => new Date().toLocaleString('en-US', { month: 'long' }),
      'current_month_short': () => new Date().toLocaleString('en-US', { month: 'short' }),
      'current_month_number': () => String(new Date().getMonth() + 1).padStart(2, '0'),
      'current_date': () => new Date().toISOString().split('T')[0],
      'current_quarter': () => `Q${Math.ceil((new Date().getMonth() + 1) / 3)}`,
    };
    if (DATE_RESOLVERS[cleanVar]) {
      const value = DATE_RESOLVERS[cleanVar]();
      variables.push({ variable: cleanVar, value, isMissing: false });
      return value;
    }

    // Check for video config variables
    if (VIDEO_CONFIG_VARIABLES.has(cleanVar)) {
      let value: string;
      if (videoConfig) {
        switch (cleanVar) {
          case 'scene_count':
            // Scene count is now calculated from voiceover duration (5s per scene)
            value = `[Calculated from voiceover]`;
            break;
          case 'video_duration':
            value = String(videoConfig.totalDuration || 60);
            break;
          case 'video_duration_minutes':
            value = String(Math.floor((videoConfig.totalDuration || 60) / 60));
            break;
          case 'scene_duration':
            // Always 5s now
            value = '5';
            break;
          default:
            value = `[Video config: ${cleanVar}]`;
        }
      } else {
        // Fallback if no video config provided
        value = `[Video config: ${cleanVar}]`;
      }
      variables.push({ variable: cleanVar, value, isMissing: false });
      return value;
    }

    // Check for AI insight variables
    if (AI_INSIGHT_VARIABLES.has(cleanVar)) {
      const resolved = resolveAiVarForPrompt(cleanVar, aiAnalysis);
      if (resolved !== null && resolved !== '') {
        variables.push({ variable: cleanVar, value: resolved, isMissing: false });
        return resolved;
      }
      // AI variable not resolved
      variables.push({ variable: cleanVar, value: null, isMissing: true });
      return `⚠️ [Not provided: ${cleanVar}]`;
    }

    // Strip arithmetic expressions (e.g., "outputConfig.slideCount minus 1" → base + operator)
    const arithmeticMatch = cleanVar.match(/^(.+?)\s+(minus|plus)\s+(\d+)$/);
    const baseVar = arithmeticMatch ? arithmeticMatch[1].trim() : cleanVar;

    // Check for system config variables (resolved at generation time)
    const SYSTEM_CONFIG_PREFIXES = ['outputConfig', 'previousStageOutputs', 'brandVoice'];
    const dotIndex = baseVar.indexOf('.');
    if (dotIndex > 0) {
      const prefix = baseVar.substring(0, dotIndex);
      if (SYSTEM_CONFIG_PREFIXES.includes(prefix)) {
        const fieldName = baseVar.substring(dotIndex + 1);
        // If outputConfig has the actual value, use it (with arithmetic)
        if (prefix === 'outputConfig' && outputConfig && outputConfig[fieldName] !== undefined && outputConfig[fieldName] !== null && outputConfig[fieldName] !== '') {
          let numValue = Number(outputConfig[fieldName]);
          if (arithmeticMatch && !isNaN(numValue)) {
            const operand = parseInt(arithmeticMatch[3], 10);
            numValue = arithmeticMatch[2] === 'minus' ? numValue - operand : numValue + operand;
          }
          const value = String(arithmeticMatch && !isNaN(numValue) ? numValue : outputConfig[fieldName]);
          variables.push({ variable: cleanVar, value, isMissing: false });
          return value;
        }
        variables.push({ variable: cleanVar, value: `[${fieldName}]`, isMissing: false });
        return `[${fieldName}]`;
      }
    }

    // Check for library element fields (e.g., product.name, library_products.name)
    if (dotIndex > 0) {
      const tableName = baseVar.substring(0, dotIndex);
      const fieldPath = baseVar.substring(dotIndex + 1);

      // Map shorthand to full table name
      const fullTableName = SHORTHAND_MAP[tableName] || tableName;

      // Get the library element data
      const elementData = libraryElements[fullTableName];

      if (elementData) {
        // Handle nested field access (e.g., features.0)
        const value = getNestedValue(elementData, fieldPath);
        if (value !== undefined && value !== null) {
          const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
          variables.push({ variable: cleanVar, value: stringValue, isMissing: false });
          return stringValue;
        }
      }

      variables.push({ variable: cleanVar, value: null, isMissing: true });
      return `⚠️ [Not provided: ${cleanVar}]`;
    }

    // Unknown variable
    variables.push({ variable: cleanVar, value: null, isMissing: true });
    return `⚠️ [Not provided: ${cleanVar}]`;
  });

  return { resolved, variables };
}

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

function generateSamples(
  promptTemplate: string,
  ideaRows: ManualIdeaRow[],
  pinnedLibraryElements: PinnedLibraryElements,
  libraryData: Record<string, any[]>,
  ideaAiAnalysis: Record<string, any> | undefined,
  videoConfig: VideoConfig | null | undefined,
  outputConfig: Record<string, any> | null | undefined,
  maxSamples: number
): PromptSample[] {
  const samples: PromptSample[] = [];

  // Get first idea
  const firstIdea = ideaRows[0];
  if (!firstIdea) return samples;

  // Build library element combinations for the first few samples
  // For each library table, get the first element(s)
  const libraryContextParts: string[] = [];
  const baseLibraryElements: Record<string, any> = {};

  Object.entries(pinnedLibraryElements).forEach(([libraryTable, config]) => {
    const elementIds = Object.keys(config.elements);
    if (elementIds.length === 0) return;

    const elements = libraryData[libraryTable] || [];
    const firstElement = elements.find(el => elementIds.includes(el.id));

    if (firstElement) {
      baseLibraryElements[libraryTable] = firstElement;
      libraryContextParts.push(firstElement.name || firstElement.title || libraryTable.replace('library_', ''));
    }
  });

  // Generate samples for first few ideas
  const ideasToSample = ideaRows.slice(0, Math.min(maxSamples, ideaRows.length));

  for (const idea of ideasToSample) {
    // Get AI analysis for this specific idea
    const aiAnalysis = ideaAiAnalysis?.[idea.id];

    const { resolved, variables } = resolvePromptWithData(
      promptTemplate,
      idea,
      baseLibraryElements,
      aiAnalysis,
      videoConfig,
      outputConfig
    );

    samples.push({
      ideaTitle: idea.context.substring(0, 60) + (idea.context.length > 60 ? '...' : ''),
      libraryContext: libraryContextParts.join(' + '),
      resolvedPrompt: resolved,
      variables,
      missingCount: variables.filter(v => v.isMissing).length,
    });
  }

  return samples;
}

export function ResolvedPromptPreview({
  promptTemplate,
  ideaRows,
  pinnedLibraryElements,
  libraryData,
  ideaAiAnalysis,
  videoConfig,
  outputConfig,
  maxSamples = 2,
  className,
  title = "Resolved Prompt Preview",
}: ResolvedPromptPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedSampleIndex, setSelectedSampleIndex] = useState(0);

  const samples = useMemo(
    () => generateSamples(promptTemplate, ideaRows, pinnedLibraryElements, libraryData, ideaAiAnalysis, videoConfig, outputConfig, maxSamples),
    [promptTemplate, ideaRows, pinnedLibraryElements, libraryData, ideaAiAnalysis, videoConfig, outputConfig, maxSamples]
  );

  const currentSample = samples[selectedSampleIndex];

  if (samples.length === 0 || !currentSample) {
    return (
      <Card className={cn("p-4 border-dashed", className)}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Eye className="h-4 w-4" />
          <span className="text-sm">Add ideas to preview resolved prompts</span>
        </div>
      </Card>
    );
  }

  const hasWarnings = currentSample.missingCount > 0;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className={cn("overflow-hidden", hasWarnings && "border-yellow-500/50", className)}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">{title}</span>
              {hasWarnings && (
                <Badge variant="outline" className="text-yellow-600 border-yellow-500/50 gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {currentSample.missingCount} unresolved
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {samples.length > 1 && (
                <div className="flex gap-1">
                  {samples.map((_, idx) => (
                    <Button
                      key={idx}
                      variant={idx === selectedSampleIndex ? "default" : "outline"}
                      size="sm"
                      className="h-6 w-6 p-0 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSampleIndex(idx);
                      }}
                    >
                      {idx + 1}
                    </Button>
                  ))}
                </div>
              )}
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t">
            {/* Context badge */}
            <div className="px-4 py-2 bg-muted/30 border-b flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground">Using:</span>
              <Badge variant="secondary" className="text-xs">
                {currentSample.ideaTitle}
              </Badge>
              {currentSample.libraryContext && (
                <>
                  <span className="text-xs text-muted-foreground">+</span>
                  <Badge variant="outline" className="text-xs">
                    {currentSample.libraryContext}
                  </Badge>
                </>
              )}
            </div>

            {/* Resolved prompt */}
            <div className="p-4">
              <div className="rounded-lg bg-muted/50 p-4 border font-mono text-sm whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">
                {renderResolvedPrompt(currentSample.resolvedPrompt, currentSample.variables)}
              </div>
            </div>

            {/* Variable legend */}
            {currentSample.variables.length > 0 && (
              <div className="px-4 pb-4">
                <div className="text-xs text-muted-foreground mb-2">Variables resolved:</div>
                <div className="flex flex-wrap gap-1">
                  {currentSample.variables.map((v, idx) => (
                    <Badge
                      key={idx}
                      variant={v.isMissing ? "destructive" : "secondary"}
                      className={cn(
                        "text-xs",
                        !v.isMissing && "bg-green-500/10 text-green-700 border-green-500/30"
                      )}
                    >
                      {v.variable}
                      {v.isMissing ? " ✗" : " ✓"}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function renderResolvedPrompt(resolvedPrompt: string, variables: ResolvedVariable[]) {
  // Split by warning markers to find unresolved variables
  // Match pattern: ⚠️ [Not provided: variable_name]
  const parts = resolvedPrompt.split(/(⚠️ \[Not provided: [^\]]+\])/g);

  return parts.map((part, idx) => {
    // Check if this is an unresolved variable marker
    if (part.startsWith('⚠️ [Not provided:') && part.endsWith(']')) {
      // Extract variable name from "⚠️ [Not provided: variable_name]"
      const varName = part.replace('⚠️ [Not provided: ', '').replace(']', '');
      return (
        <span
          key={idx}
          className="inline-flex items-center gap-1 bg-red-500/20 text-red-700 dark:text-red-400 px-1.5 py-0.5 rounded border border-red-500/30 text-xs font-medium"
          title={`Variable {{${varName}}} has no data - select library element or fill in the field`}
        >
          <AlertTriangle className="h-3 w-3" />
          Missing: {varName}
        </span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

