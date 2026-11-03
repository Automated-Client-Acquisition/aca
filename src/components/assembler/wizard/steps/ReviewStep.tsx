import { useMemo, useState, useEffect, useCallback } from "react";
import { Blueprint, PinnedLibraryElements } from "@/types/blueprint";
import { AI_INSIGHT_VARIABLES, AI_INSIGHT_FIELD_MAP } from "@/lib/ai-insights";
import { ManualIdeaRow } from "@/types/generation";
import { VideoConfig, OutputConfig, ASPECT_RATIO_DIMENSIONS, IdeaAiInsightsMap } from "@/types/wizard";
import type { PresenterVideoConfigValues } from "@/components/presenter/PresenterVideoConfig";
import type { VideoRemixConfigValues } from "@/components/remix/VideoRemixConfig";
import type { VideoConfig as UnifiedVideoConfigType } from "@/types/video";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PromptPreview } from "@/components/PromptPreview";
import { ResolvedPromptPreview } from "@/components/ResolvedPromptPreview";
import { VisualReferencesSection } from "../components/VisualReferencesSection";
import {
  FileText,
  Library,
  Layers,
  Zap,
  Cpu,
  Film,
  Image,
  ImageIcon,
  X,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  MessageSquare,
  Target,
  Mic,
  ArrowRight
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCreateGenerationJob } from "@/hooks/useCreateGenerationJob";
import { MissingApiKeyAlert } from "@/components/MissingApiKeyAlert";
import { useBulkCreateIdeas } from "@/hooks/useBulkCreateIdeas";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useCharacters } from "@/hooks/useCharacters";
import { useBlocks } from "@/hooks/useBlocks";
import { useProducts } from "@/hooks/useProducts";
import { useICPs } from "@/hooks/useICPs";
import { useLibraryImages } from "@/hooks/useLibraryImages";
import { useIdeas } from "@/hooks/useIdeas";
import { explodeGenerationItems } from "@/lib/generationUtils";
import { isUUID } from "@/lib/utils";
import { formatLabel } from "@/lib/blueprintCardUtils";
import { cn } from "@/lib/utils";
import { requiresTTS, getPipelineOutputSummary } from "@/lib/pipelineUtils";
import { PipelineId } from "@/types/pipeline";

// Static map of well-known ElevenLabs voice IDs to human-readable names
const KNOWN_VOICE_NAMES: Record<string, string> = {
  'pNInz6obpgDQGcFmaJgB': 'Adam',
  'EXAVITQu4vr4xnSDxMaL': 'Bella',
  '21m00Tcm4TlvDq8ikWAM': 'Rachel',
  'ErXwobaYiN019PkySvjV': 'Antoni',
  'AZnzlk1XvdvUeBnXmlld': 'Domi',
  'MF3mGyEYCl7XYWbV9V6O': 'Elli',
  'TxGEqnHWrfWFTfGW9XjX': 'Josh',
  'yoZ06aMxZJJ28mfd3POQ': 'Sam',
};

function resolveVoiceName(voiceId: string): string {
  return KNOWN_VOICE_NAMES[voiceId] || voiceId;
}

interface ReviewStepProps {
  blueprint: Blueprint;
  ideaRows: ManualIdeaRow[];
  pinnedLibraryElements: PinnedLibraryElements;
  customPrompt: string | null;
  customImagePrompt: string | null;
  customDirectorPrompt: string | null;
  videoConfig: VideoConfig | null;
  outputConfig: OutputConfig | null;
  presenterConfig?: PresenterVideoConfigValues | null;
  remixConfig?: VideoRemixConfigValues | null;
  unifiedVideoConfig?: UnifiedVideoConfigType | null;
  preRecordedEditorState?: import("@/contexts/RecorderContext").RecordingMetadata | null;
  hasConfirmedReview: boolean;
  ideaAiInsights: IdeaAiInsightsMap;
  autoApproveAll: boolean;
  onCustomPromptChange: (prompt: string | null) => void;
  onCustomImagePromptChange: (prompt: string | null) => void;
  onCustomDirectorPromptChange: (prompt: string | null) => void;
  onHasConfirmedReviewChange: (confirmed: boolean) => void;
  onAutoApproveAllChange: (enabled: boolean) => void;
  onReset: () => void;
  onGenerate?: (handler: () => Promise<void>) => void;
}

const LIBRARY_TABLE_LABELS: Record<string, string> = {
  library_brand_voices: "Brands",
  library_characters: "People & Faces",
  library_blocks: "Blocks",
  library_products: "Products",
  library_icps: "ICPs",
  library_images: "Style & Composition",
};

const MODEL_TYPE_LABELS: Record<string, string> = {
  text_llm: "Text Generation (LLM)",
  image_generator: "Image Generation",
  tts: "Text-to-Speech",
  face_swap: "Face Swap",
  world_simulator: "World Simulator",
};

// Model config keys that should be skipped in the AI Models section
const SKIP_MODEL_CONFIG_KEYS = ['provider', 'model_id', 'parameters', 'content_type'];

// Pipelines that require video configuration
const VIDEO_PIPELINES = [
  'ugc_video',
  'generative_video_oneshot',
  'storyboard_video_longform',
];

// Pipelines that generate visual content (non-video)
// rich_article excluded - always uses landscape for blog images
const VISUAL_PIPELINES = [
  'social_media_post',
  'instagram_carousel',
  'image_only',
];

// Pipelines that use image_prompt as the primary/only prompt (no master_prompt)
const IMAGE_ONLY_PIPELINES = ['image_only'];

// Pipelines that have a director stage and can use director_prompt
const DIRECTOR_PIPELINES = ['video', 'presenter_video'];

// Shorthand mapping for variable validation
const VARIABLE_SHORTHAND_MAP: Record<string, string> = {
  'product': 'library_products',
  'brand': 'library_brand_voices',
  'brand_voice': 'library_brand_voices', // Legacy alias
  'character': 'library_characters',
  'block': 'library_blocks',
  'icp': 'library_icps',
  'identity': 'library_identities',
};

// AI insight variables imported from shared utility

// Video config variable names (resolved at job dispatch time, not at validation time)
const VIDEO_CONFIG_VARIABLES = new Set([
  'scene_count',
  'video_duration',
  'video_duration_minutes',
  'scene_duration',
]);

// AI_INSIGHT_FIELD_MAP imported from shared utility

interface VariableValidation {
  variable: string;
  status: 'resolved' | 'missing_selection' | 'missing_field';
  message: string;
}

// Validate that all prompt variables can be resolved
function validatePromptVariables(
  promptTemplate: string,
  pinnedLibraryElements: PinnedLibraryElements,
  libraryData: Record<string, any[]>,
  ideaAiAnalysis?: Record<string, any>
): VariableValidation[] {
  const validations: VariableValidation[] = [];
  const variableRegex = /\{\{([^}]+)\}\}/g;
  const matches = Array.from(promptTemplate.matchAll(variableRegex));

  const seenVariables = new Set<string>();

  matches.forEach(match => {
    const variable = match[1].trim().replace(/^\?/, '');
    if (seenVariables.has(variable)) return;
    seenVariables.add(variable);

    // Check for idea-related variables (always available)
    if (['idea', 'context', 'title', 'description', 'topic'].includes(variable)) {
      validations.push({
        variable,
        status: 'resolved',
        message: 'Will use the idea content'
      });
      return;
    }

    // Check for idea free text variable
    if (variable === 'idea_text') {
      validations.push({
        variable,
        status: 'resolved',
        message: 'Will use free text from the idea (if provided)'
      });
      return;
    }

    // Check for video config variables (resolved at job dispatch time)
    if (VIDEO_CONFIG_VARIABLES.has(variable)) {
      validations.push({
        variable,
        status: 'resolved',
        message: 'Will use video configuration values'
      });
      return;
    }

    // Check for AI insight variables
    if (AI_INSIGHT_VARIABLES.has(variable)) {
      // Check if any selected idea has the corresponding AI analysis data
      const fieldPaths = AI_INSIGHT_FIELD_MAP[variable] || [];
      let hasData = false;

      console.log('[validatePromptVariables] Checking AI variable:', variable, {
        fieldPaths,
        ideaAiAnalysisKeys: ideaAiAnalysis ? Object.keys(ideaAiAnalysis) : [],
      });

      if (ideaAiAnalysis) {
        for (const ideaId of Object.keys(ideaAiAnalysis)) {
          const rawAnalysis = ideaAiAnalysis[ideaId];
          if (!rawAnalysis) continue;

          // Parse if it's a JSON string
          let analysis;
          try {
            analysis = typeof rawAnalysis === 'string'
              ? JSON.parse(rawAnalysis)
              : rawAnalysis;
          } catch {
            continue; // Skip malformed JSON
          }

          console.log('[validatePromptVariables] Checking idea:', ideaId, {
            analysisKeys: Object.keys(analysis),
            fieldPathsToCheck: fieldPaths,
          });

          // Check each possible field path
          for (const fieldPath of fieldPaths) {
            const value = analysis[fieldPath];
            console.log('[validatePromptVariables] Field check:', fieldPath, {
              hasValue: value !== undefined && value !== null,
              isArray: Array.isArray(value),
              arrayLength: Array.isArray(value) ? value.length : 'N/A',
            });
            if (value !== undefined && value !== null) {
              // For arrays, check if non-empty
              if (Array.isArray(value)) {
                if (value.length > 0) {
                  hasData = true;
                  break;
                }
              } else if (typeof value === 'object') {
                // For objects (like script_structure), check if has properties
                if (Object.keys(value).length > 0) {
                  hasData = true;
                  break;
                }
              } else if (value !== '') {
                hasData = true;
                break;
              }
            }
          }
          if (hasData) break;
        }
      }

      console.log('[validatePromptVariables] Result for', variable, ':', hasData ? 'RESOLVED' : 'MISSING');

      if (hasData) {
        validations.push({
          variable,
          status: 'resolved',
          message: 'Will use AI-analyzed insights from idea'
        });
      } else {
        validations.push({
          variable,
          status: 'missing_field',
          message: 'Selected ideas do not have this AI insight data'
        });
      }
      return;
    }

    // Strip arithmetic expressions (e.g., "outputConfig.slideCount minus 1" → "outputConfig.slideCount")
    const arithmeticMatch = variable.match(/^(.+?)\s+(minus|plus)\s+(\d+)$/);
    const baseVariable = arithmeticMatch ? arithmeticMatch[1].trim() : variable;

    // Check for system config variables (resolved at generation time)
    const SYSTEM_CONFIG_PREFIXES = ['outputConfig', 'previousStageOutputs', 'brandVoice'];
    const baseDotIndex = baseVariable.indexOf('.');
    if (baseDotIndex > 0) {
      const prefix = baseVariable.substring(0, baseDotIndex);
      if (SYSTEM_CONFIG_PREFIXES.includes(prefix)) {
        validations.push({
          variable,
          status: 'resolved',
          message: 'Will use system configuration values'
        });
        return;
      }
    }

    // Check for date variables (resolved at generation time)
    const DATE_VARS = new Set([
      'current_year', 'current_month', 'current_month_short', 'current_month_number',
      'current_date', 'current_quarter',
    ]);
    if (DATE_VARS.has(baseVariable)) {
      validations.push({
        variable,
        status: 'resolved',
        message: 'Will use current date/time values'
      });
      return;
    }

    // Check for library element fields
    const dotIndex = baseVariable.indexOf('.');
    if (dotIndex > 0) {
      const tableName = baseVariable.substring(0, dotIndex);
      const fieldName = baseVariable.substring(dotIndex + 1);
      const fullTableName = VARIABLE_SHORTHAND_MAP[tableName] || tableName;

      // Check if library type is selected
      const libraryConfig = pinnedLibraryElements[fullTableName];
      if (!libraryConfig || Object.keys(libraryConfig.elements).length === 0) {
        validations.push({
          variable,
          status: 'missing_selection',
          message: `No ${LIBRARY_TABLE_LABELS[fullTableName] || tableName} selected`
        });
        return;
      }

      // Check if any selected element has this field populated
      const elementIds = Object.keys(libraryConfig.elements);
      const elements = (libraryData[fullTableName] || []).filter(el => elementIds.includes(el.id));

      const hasField = elements.some(el => {
        const value = getNestedFieldValue(el, fieldName);
        return value !== undefined && value !== null && value !== '';
      });

      if (!hasField) {
        validations.push({
          variable,
          status: 'missing_field',
          message: `Field "${fieldName}" is empty in selected items`
        });
      } else {
        validations.push({
          variable,
          status: 'resolved',
          message: `Will use ${LIBRARY_TABLE_LABELS[fullTableName] || tableName} data`
        });
      }
    } else {
      // Unknown variable
      validations.push({
        variable,
        status: 'missing_selection',
        message: 'Unknown variable'
      });
    }
  });

  return validations;
}

function getNestedFieldValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
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

export function ReviewStep({
  blueprint,
  ideaRows,
  pinnedLibraryElements,
  customPrompt,
  customImagePrompt,
  customDirectorPrompt,
  videoConfig,
  outputConfig,
  presenterConfig,
  remixConfig,
  unifiedVideoConfig,
  preRecordedEditorState,
  hasConfirmedReview,
  ideaAiInsights,
  autoApproveAll,
  onCustomPromptChange,
  onCustomImagePromptChange,
  onCustomDirectorPromptChange,
  onHasConfirmedReviewChange,
  onAutoApproveAllChange,
  onReset,
  onGenerate,
}: ReviewStepProps) {
  const navigate = useNavigate();
  const { mutate: createJob, isPending: isCreatingJob } = useCreateGenerationJob();
  const { mutate: bulkCreateIdeas, isPending: isSavingIdeas } = useBulkCreateIdeas();
  const [updatedIdeaRows, setUpdatedIdeaRows] = useState<ManualIdeaRow[]>(ideaRows);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isCustomizingImagePrompt, setIsCustomizingImagePrompt] = useState(false);
  const [isCustomizingDirectorPrompt, setIsCustomizingDirectorPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(customPrompt || blueprint.master_prompt || "");
  const [imagePromptDraft, setImagePromptDraft] = useState(customImagePrompt || blueprint.image_prompt || "");
  const [directorPromptDraft, setDirectorPromptDraft] = useState(customDirectorPrompt || blueprint.director_prompt || "");

  const isPending = isCreatingJob || isSavingIdeas;

  // Sync master prompt customization state with parent
  useEffect(() => {
    if (isCustomizing && promptDraft !== blueprint.master_prompt) {
      onCustomPromptChange(promptDraft);
    } else if (!isCustomizing) {
      onCustomPromptChange(null);
    }
  }, [isCustomizing, promptDraft, blueprint.master_prompt, onCustomPromptChange]);

  // Sync image prompt customization state with parent
  useEffect(() => {
    if (isCustomizingImagePrompt && imagePromptDraft !== blueprint.image_prompt) {
      onCustomImagePromptChange(imagePromptDraft);
    } else if (!isCustomizingImagePrompt) {
      onCustomImagePromptChange(null);
    }
  }, [isCustomizingImagePrompt, imagePromptDraft, blueprint.image_prompt, onCustomImagePromptChange]);

  // Sync director prompt customization state with parent
  useEffect(() => {
    if (isCustomizingDirectorPrompt && directorPromptDraft !== blueprint.director_prompt) {
      onCustomDirectorPromptChange(directorPromptDraft);
    } else if (!isCustomizingDirectorPrompt) {
      onCustomDirectorPromptChange(null);
    }
  }, [isCustomizingDirectorPrompt, directorPromptDraft, blueprint.director_prompt, onCustomDirectorPromptChange]);

  // Fetch library data for all selected library types
  const { brandVoices = [] } = useBrandVoices();
  const { characters = [] } = useCharacters();
  const { blocks = [] } = useBlocks();
  const { products = [] } = useProducts();
  const { icps = [] } = useICPs();
  const { libraryImages = [] } = useLibraryImages();
  const { ideas: dbIdeas = [] } = useIdeas();

  // Prepare library data lookup
  const libraryData = useMemo(() => ({
    library_brand_voices: brandVoices,
    library_characters: characters,
    library_blocks: blocks,
    library_products: products,
    library_icps: icps,
    library_images: libraryImages,
  }), [brandVoices, characters, blocks, products, icps, libraryImages]);

  // Build AI analysis map from database ideas
  const ideaAiAnalysis = useMemo(() => {
    const analysisMap: Record<string, any> = {};

    console.log('[ReviewStep] Building ideaAiAnalysis:', {
      ideaRowIds: ideaRows.map(r => r.id),
      dbIdeasCount: dbIdeas.length,
    });

    for (const row of ideaRows) {
      const dbIdea = dbIdeas.find(idea => idea.id === row.id);

      console.log('[ReviewStep] Matching idea:', {
        rowId: row.id,
        found: !!dbIdea,
        title: dbIdea?.title?.substring(0, 40),
      });

      if (!dbIdea) continue;

      // Parse ai_analysis (talking_points now live inside it)
      let analysis: Record<string, any> = {};
      if (dbIdea.ai_analysis) {
        try {
          analysis = typeof dbIdea.ai_analysis === 'string'
            ? JSON.parse(dbIdea.ai_analysis)
            : { ...dbIdea.ai_analysis };
        } catch {
          analysis = {};
        }
      }

      // Only add to map if we have something
      if (Object.keys(analysis).length > 0) {
        analysisMap[row.id] = analysis;
        console.log('[ReviewStep] Added analysis for:', row.id, 'keys:', Object.keys(analysis));
      }
    }
    console.log('[ReviewStep] Final map size:', Object.keys(analysisMap).length);
    return analysisMap;
  }, [ideaRows, dbIdeas]);

  // Build preview-time outputConfig for prompt variable resolution
  const previewOutputConfig = useMemo(() => {
    const mc = blueprint.model_config as Record<string, any> | undefined;
    const isCarousel = blueprint.pipeline === 'instagram_carousel';
    return {
      ...(outputConfig || {}),
      ...(isCarousel ? {
        slideCount: mc?.carousel_slide_count || (outputConfig as any)?.slideCount || 5,
        ...(mc?.carousel_cta_text ? { ctaButtonText: mc.carousel_cta_text } : {}),
      } : {}),
    };
  }, [blueprint.model_config, blueprint.pipeline, outputConfig]);

  // Get first idea's free text for preview
  const firstIdeaFreeText = useMemo(() => {
    if (!ideaRows.length) return undefined;
    // Check ManualIdeaRow first (carries freeText when selected from bank)
    if (ideaRows[0].freeText) return ideaRows[0].freeText;
    // Fall back to database lookup
    const dbIdea = dbIdeas.find(idea => idea.id === ideaRows[0].id);
    return dbIdea?.free_text || undefined;
  }, [ideaRows, dbIdeas]);

  // Calculate total variations - accounts for ideas, AI insight variations, and library elements
  // This must match the logic in explodeGenerationItems from generationUtils.ts
  const variationBreakdown = useMemo(() => {
    // Track AI insight breakdown per idea
    const aiInsightBreakdown: Array<{
      ideaLabel: string;
      hookCount: number;
      hookMode: 'combine' | 'separate';
      talkingPointCount: number;
      talkingPointMode: 'combine' | 'separate';
      ctaCount: number;
      ctaMode: 'combine' | 'separate';
      itemCount: number;
    }> = [];

    // Calculate per-idea variations (matching explodeGenerationItems logic)
    let totalIdeaVariations = 0;
    ideaRows.forEach(row => {
      const insights = ideaAiInsights[row.id];
      const dbIdea = dbIdeas.find(idea => idea.id === row.id);
      const hasAiAnalysis = !!dbIdea?.ai_analysis;

      // Hook variations: separate mode multiplies, combine mode doesn't
      const useHookVariations = insights?.createVariations &&
        insights.selectedHookIndices.length > 0 &&
        insights.hookMode === 'separate' &&
        hasAiAnalysis;
      const hookMultiplier = useHookVariations ? insights!.selectedHookIndices.length : 1;

      // Talking point variations: separate mode multiplies, combine mode doesn't
      const useTalkingPointVariations = insights?.createTalkingPointVariations &&
        (insights.selectedTalkingPointIndices?.length || 0) > 0 &&
        insights.talkingPointMode === 'separate' &&
        hasAiAnalysis;
      const talkingPointMultiplier = useTalkingPointVariations
        ? insights!.selectedTalkingPointIndices!.length
        : 1;

      // CTA variations: separate mode multiplies, combine mode doesn't
      const useCtaVariations = insights?.includeCta &&
        (insights.selectedCtaIndices?.length || 0) > 0 &&
        insights.ctaMode === 'separate' &&
        hasAiAnalysis;
      const ctaMultiplier = useCtaVariations
        ? insights!.selectedCtaIndices!.length
        : 1;

      // Cartesian product of all variation dimensions for this idea
      const ideaItemCount = hookMultiplier * talkingPointMultiplier * ctaMultiplier;
      totalIdeaVariations += ideaItemCount;

      // Track breakdown for display
      if (insights && (useHookVariations || useTalkingPointVariations || useCtaVariations)) {
        aiInsightBreakdown.push({
          ideaLabel: row.context.substring(0, 40) + (row.context.length > 40 ? '...' : ''),
          hookCount: useHookVariations ? insights.selectedHookIndices.length : 0,
          hookMode: insights.hookMode || 'combine',
          talkingPointCount: useTalkingPointVariations ? insights.selectedTalkingPointIndices!.length : 0,
          talkingPointMode: insights.talkingPointMode || 'combine',
          ctaCount: useCtaVariations ? insights.selectedCtaIndices!.length : 0,
          ctaMode: insights.ctaMode || 'combine',
          itemCount: ideaItemCount,
        });
      }
    });

    const libraryBreakdown: Array<{
      label: string;
      count: number;
      mode: 'combine' | 'separate';
      includedFieldsCount: number;
    }> = [];

    let libraryMultiplier = 1;

    Object.entries(pinnedLibraryElements).forEach(([libraryTable, config]) => {
      const elementIds = Object.keys(config.elements);
      if (elementIds.length === 0) return;

      const label = LIBRARY_TABLE_LABELS[libraryTable] || libraryTable;
      // Default to 'separate' to match LibraryStepTemplate behavior
      const mode = config.combination_mode || 'separate';

      // Count included fields across all elements (just for display)
      let totalIncludedFields = 0;
      elementIds.forEach(elementId => {
        const element = config.elements[elementId];
        if (element.paths) {
          totalIncludedFields += Object.values(element.paths).filter(p => p.included).length;
        }
      });

      libraryBreakdown.push({
        label,
        count: elementIds.length,
        mode,
        includedFieldsCount: totalIncludedFields,
      });

      // Only multiply at library level, not nested field level
      if (mode === 'separate') {
        libraryMultiplier *= elementIds.length;
      }
    });

    // Total = (sum of per-idea variations) × library multiplier
    const totalVariations = totalIdeaVariations * libraryMultiplier;

    // Summary counts for AI insights that multiply
    const hasHookVariations = aiInsightBreakdown.some(b => b.hookCount > 0 && b.hookMode === 'separate');
    const hasTalkingPointVariations = aiInsightBreakdown.some(b => b.talkingPointCount > 0 && b.talkingPointMode === 'separate');
    const hasCtaVariations = aiInsightBreakdown.some(b => b.ctaCount > 0 && b.ctaMode === 'separate');

    return {
      ideaCount: ideaRows.length,
      libraryBreakdown,
      aiInsightBreakdown,
      totalVariations,
      totalIdeaVariations,
      hasHookVariations,
      hasTalkingPointVariations,
      hasCtaVariations,
    };
  }, [ideaRows, pinnedLibraryElements, ideaAiInsights, dbIdeas]);

  // Generate preview of all exploded items (for the full variation list)
  const explodedItemsPreview = useMemo(() => {
    return explodeGenerationItems(ideaRows, pinnedLibraryElements, libraryData, ideaAiInsights, ideaAiAnalysis, 'force_all', blueprint.pipeline as PipelineId);
  }, [ideaRows, pinnedLibraryElements, libraryData, ideaAiInsights, ideaAiAnalysis, blueprint.pipeline]);

  // State for variation list expansion
  const [isVariationListExpanded, setIsVariationListExpanded] = useState(false);

  // Validate prompt variables
  const promptValidation = useMemo(() => {
    const masterPrompt = customPrompt || blueprint.master_prompt || "";
    const imagePrompt = blueprint.image_prompt || "";

    console.log('[promptValidation] Starting validation with ideaAiAnalysis keys:', Object.keys(ideaAiAnalysis));

    const masterValidations = validatePromptVariables(masterPrompt, pinnedLibraryElements, libraryData, ideaAiAnalysis);
    const imageValidations = imagePrompt
      ? validatePromptVariables(imagePrompt, pinnedLibraryElements, libraryData, ideaAiAnalysis)
      : [];

    const allValidations = [...masterValidations, ...imageValidations];
    const warnings = allValidations.filter(v => v.status !== 'resolved');
    const resolved = allValidations.filter(v => v.status === 'resolved');

    console.log('[promptValidation] Results:', {
      masterWarnings: masterValidations.filter(v => v.status !== 'resolved').map(v => v.variable),
      imageWarnings: imageValidations.filter(v => v.status !== 'resolved').map(v => v.variable),
      totalWarnings: warnings.length,
      totalResolved: resolved.length,
    });

    return {
      masterValidations,
      imageValidations,
      warnings,
      resolved,
      hasWarnings: warnings.length > 0
    };
  }, [customPrompt, blueprint.master_prompt, blueprint.image_prompt, pinnedLibraryElements, libraryData, ideaAiAnalysis]);

  // Validate voice configuration for TTS pipelines
  const voiceValidation = useMemo(() => {
    // Only validate for TTS pipelines
    if (!requiresTTS(blueprint.pipeline)) {
      return null;
    }

    // Get selected characters
    const selectedCharacterIds = Object.keys(pinnedLibraryElements.library_characters?.elements || {});
    const selectedCharacters = characters.filter(c => selectedCharacterIds.includes(c.id));

    // If no characters selected for TTS pipeline, warn
    if (selectedCharacters.length === 0) {
      // Check if blueprint has voice fallback
      const blueprintVoiceId = blueprint.model_config?.tts?.parameters?.voice_id || blueprint.model_config?.tts?.voice_id;
      if (blueprintVoiceId) {
        const blueprintVoiceName = blueprintVoiceId ? resolveVoiceName(blueprintVoiceId as string) : null;
        return {
          status: 'resolved' as const,
          voiceSource: 'blueprint' as const,
          voiceName: blueprintVoiceName,
          message: blueprintVoiceName
            ? `Blueprint default voice "${blueprintVoiceName}" will be used`
            : 'Blueprint default voice will be used'
        };
      }
      return {
        status: 'warning' as const,
        voiceSource: 'default' as const,
        message: 'No character selected — voiceover will use the default "Bella" voice',
        actionMessage: 'Go back to the Library step and select a character with a configured voice for personalized voiceovers.'
      };
    }

    // Check if any selected character has a voice configured
    const characterWithVoice = selectedCharacters.find(c => {
      if (c.voice_selection) return true;
      if (c.voice_config) {
        const config = typeof c.voice_config === 'string' ? JSON.parse(c.voice_config) : c.voice_config;
        return !!config?.voice_id;
      }
      return false;
    });

    if (characterWithVoice) {
      const voiceId = characterWithVoice.voice_selection ||
        (typeof characterWithVoice.voice_config === 'string'
          ? JSON.parse(characterWithVoice.voice_config)
          : characterWithVoice.voice_config)?.voice_id;
      const voiceName = voiceId ? resolveVoiceName(voiceId) : null;
      return {
        status: 'resolved' as const,
        voiceSource: 'character' as const,
        characterName: characterWithVoice.name,
        voiceName,
        message: voiceName
          ? `Voice "${voiceName}" from character "${characterWithVoice.name}" will be used`
          : `Voice from character "${characterWithVoice.name}" will be used`
      };
    }

    // Character selected but no voice - check for blueprint fallback
    const blueprintVoiceId = blueprint.model_config?.tts?.parameters?.voice_id || blueprint.model_config?.tts?.voice_id;
    const characterName = selectedCharacters[0].name;

    if (blueprintVoiceId) {
      const blueprintVoiceName = blueprintVoiceId ? resolveVoiceName(blueprintVoiceId as string) : null;
      return {
        status: 'warning' as const,
        voiceSource: 'blueprint' as const,
        characterName,
        message: `Character "${characterName}" has no voice configured`,
        actionMessage: blueprintVoiceName
          ? `The voiceover will fall back to the blueprint's default voice "${blueprintVoiceName}". To use a custom voice, edit this character in Library → Characters and configure a voice.`
          : 'The voiceover will fall back to the blueprint\'s default voice. To use a custom voice, edit this character in Library → Characters and configure a voice.'
      };
    }

    // No character voice, no blueprint voice - will use system default
    return {
      status: 'warning' as const,
      voiceSource: 'default' as const,
      characterName,
      message: `Character "${characterName}" has no voice configured`,
      actionMessage: 'The voiceover will fall back to the default "Bella" voice. To use a custom voice, edit this character in Library → Characters and configure a voice.'
    };
  }, [blueprint.pipeline, blueprint.model_config?.tts, pinnedLibraryElements.library_characters, characters]);

  // Pipeline output summary for the "What This Will Produce" card
  const pipelineOutput = useMemo(() => {
    if (!blueprint.pipeline) return null;
    return getPipelineOutputSummary(blueprint.pipeline as PipelineId);
  }, [blueprint.pipeline]);

  const handleGenerate = useCallback(async () => {
    if (!hasConfirmedReview) {
      toast.error("Please confirm you've reviewed the configuration");
      return;
    }

    if (!blueprint) {
      toast.error("No blueprint selected");
      return;
    }

    try {
      // Step 1: Identify manual ideas that need to be saved (NanoIDs)
      const unsavedIdeas = updatedIdeaRows.filter(row => !isUUID(row.id));
      
      let finalIdeaRows = updatedIdeaRows;

      // Step 2: Save unsaved ideas to database if any exist
      if (unsavedIdeas.length > 0) {
        console.log(`💾 Saving ${unsavedIdeas.length} manual ideas to database...`);
        
        await new Promise<void>((resolve, reject) => {
          bulkCreateIdeas(
            { contexts: unsavedIdeas.map(idea => idea.context) },
            {
              onSuccess: (createdIdeas) => {
                // Create mapping of old NanoID to new UUID
                const idMapping = new Map<string, string>();
                unsavedIdeas.forEach((unsavedIdea, index) => {
                  idMapping.set(unsavedIdea.id, createdIdeas[index].id);
                });

                // Update idea rows with database UUIDs
                finalIdeaRows = updatedIdeaRows.map(row => {
                  const newId = idMapping.get(row.id);
                  return newId ? { ...row, id: newId } : row;
                });

                setUpdatedIdeaRows(finalIdeaRows);
                console.log(`✅ Saved ${createdIdeas.length} new idea${createdIdeas.length !== 1 ? 's' : ''} to library`);
                toast.success(`Saved ${createdIdeas.length} new idea${createdIdeas.length !== 1 ? 's' : ''} to library`);
                resolve();
              },
              onError: (error) => {
                reject(error);
              }
            }
          );
        });
      }

      // Step 3: Verify all IDs are UUIDs
      const invalidIds = finalIdeaRows.filter(row => !isUUID(row.id));
      if (invalidIds.length > 0) {
        throw new Error(`${invalidIds.length} ideas still have invalid IDs after saving`);
      }

      // Step 4: Explode generation items with verified UUIDs and AI insights
      // Always use 'force_all' mode - selected images should always be used
      let items = explodeGenerationItems(finalIdeaRows, pinnedLibraryElements, libraryData, ideaAiInsights, ideaAiAnalysis, 'force_all', blueprint.pipeline as PipelineId);

      // For recording mode with no ideas, create a synthetic item so the backend
      // has at least one output to process (the recording itself is the content)
      if (items.length === 0 && preRecordedEditorState) {
        items = [{
          idea_id: null as any, // No idea — recording is the content. idea_id is nullable in DB.
          idea_title: 'Screen Recording',
          slot_values: {},
          library_elements: pinnedLibraryElements,
        }];
      }

      console.log(`🚀 Exploded ${finalIdeaRows.length} ideas into ${items.length} generation items`);

      // Step 5: Create generation job
      // Merge blueprint-level carousel config into output_config so backend receives it
      const mc = blueprint.model_config as Record<string, any> | undefined;
      const isCarousel = blueprint.pipeline === 'instagram_carousel';
      const mergedOutputConfig = outputConfig ? {
        ...outputConfig,
        ...(isCarousel ? {
          carouselTemplate: mc?.carousel_template || 'classic',
          slideCount: mc?.carousel_slide_count || outputConfig.slideCount || 5,
          ...(mc?.carousel_cta_text ? { ctaButtonText: mc.carousel_cta_text } : {}),
          ...(mc?.carousel_handle ? { authorHandle: mc.carousel_handle } : {}),
          ...(mc?.carousel_custom_palette ? { customPalette: mc.carousel_custom_palette } : {}),
          ...(mc?.carousel_background_image ? { backgroundImageUrl: mc.carousel_background_image } : {}),
        } : {}),
      } : outputConfig;

      // For unified 'video' pipeline, build video_config from unifiedVideoConfig + recording metadata
      // For legacy pipelines (presenter_video, etc.), use videoConfig as-is
      const resolvedVideoConfig = blueprint.pipeline === 'video' && unifiedVideoConfig ? {
        // For recordings, pass video URLs so the pipeline can transcribe + direct
        ...(preRecordedEditorState ? {
          screen_video_url: preRecordedEditorState.screenVideoUrl,
          webcam_video_url: preRecordedEditorState.webcamVideoUrl,
        } : {}),
        source: unifiedVideoConfig.source,
        source_url: unifiedVideoConfig.sourceUrl,
        uploaded_video_url: unifiedVideoConfig.uploadedVideoUrl,
        uploaded_image_urls: unifiedVideoConfig.uploadedImageUrls,
        narration_mode: unifiedVideoConfig.narrationMode,
        rewrite_style: unifiedVideoConfig.rewriteStyle,
        target_language: unifiedVideoConfig.targetLanguage,
        custom_rewrite_instructions: unifiedVideoConfig.customRewriteInstructions,
        target_duration: unifiedVideoConfig.targetDuration,
        voice_mode: unifiedVideoConfig.voiceMode,
        lip_sync_provider: unifiedVideoConfig.lipSyncProvider,
        avatar_photo_url: unifiedVideoConfig.avatarPhotoUrl,
        heygen_avatar_id: unifiedVideoConfig.heygenAvatarId,
        image_mode: unifiedVideoConfig.imageMode,
        b_roll_enabled: unifiedVideoConfig.bRollEnabled,
        b_roll_style: unifiedVideoConfig.bRollStyle,
        orientation: unifiedVideoConfig.orientation,
        aspect_ratio: unifiedVideoConfig.aspectRatio,
        subtitle_style: unifiedVideoConfig.subtitleStyle,
        background_music_url: unifiedVideoConfig.backgroundMusicUrl,
        background_music_volume: unifiedVideoConfig.backgroundMusicVolume,
        transition_type: unifiedVideoConfig.transitionType,
      } : videoConfig;

      const jobConfig = {
        blueprint_id: blueprint.id,
        pipeline: blueprint.pipeline,
        items,
        video_config: resolvedVideoConfig,
        output_config: mergedOutputConfig,
        configuration: {
          blueprint_name: blueprint.name,
          pipeline: blueprint.pipeline || 'youtube-script',
          model_config: blueprint.model_config,
          auto_approve_all: autoApproveAll,
          blueprint: {
            ...blueprint,
            master_prompt: customPrompt || blueprint.master_prompt,
            image_prompt: customImagePrompt || blueprint.image_prompt,
            director_prompt: customDirectorPrompt || blueprint.director_prompt
          },
          // Presenter video pipeline config — production settings only
          // Creative direction comes from master_prompt via {{masterPrompt}} in director stage
          // Voice/avatar come from pinned Library Character via ExecutionContext
          ...(blueprint.pipeline === 'presenter_video' && presenterConfig ? {
            presenter_config: {
              voice_type: presenterConfig.voiceType,
              b_roll_enabled: presenterConfig.bRollEnabled,
              b_roll_style: presenterConfig.bRollStyle,
              subtitle_style: presenterConfig.subtitleStyle,
              orientation: presenterConfig.orientation,
              background_music_url: presenterConfig.backgroundMusicUrl,
            },
            // Also spread top-level fields that handlers read directly
            voice_type: presenterConfig.voiceType,
            b_roll_enabled: presenterConfig.bRollEnabled,
            b_roll_style: presenterConfig.bRollStyle,
            subtitle_style: presenterConfig.subtitleStyle,
            orientation: presenterConfig.orientation,
            background_music_url: presenterConfig.backgroundMusicUrl,
          } : {}),
          // Video remix pipeline config — merges blueprint creative direction + per-job production settings
          ...(blueprint.pipeline === 'video_remix' && remixConfig ? {
            remix_config: {
              // Creative direction from blueprint model_config
              rewrite_style: blueprint.model_config?.remix_rewrite_style || 'polish',
              visual_style: remixConfig.visualStyle || blueprint.model_config?.remix_visual_style || 'enhance',
              template_type: blueprint.model_config?.remix_template_type || remixConfig.templateType,
              target_language: blueprint.model_config?.remix_target_language,
              custom_rewrite_instructions: blueprint.model_config?.remix_custom_rewrite_instructions,
              // Production settings from remix config
              voice_option: remixConfig.voiceOption,
              voice_id: remixConfig.voiceId,
              avatar_type: remixConfig.avatarType,
              avatar_photo_url: remixConfig.avatarPhotoUrl,
              heygen_avatar_id: remixConfig.heygenAvatarId,
              character_id: remixConfig.characterId,
              lip_sync_provider: remixConfig.lipSyncProvider,
              b_roll_enabled: remixConfig.bRollEnabled,
              b_roll_style: remixConfig.bRollStyle,
              subtitle_style: remixConfig.subtitleStyle,
              orientation: remixConfig.orientation,
              background_music_url: remixConfig.backgroundMusicUrl,
              max_frames: remixConfig.maxFrames,
            },
            // Also spread top-level fields that handlers read directly
            source_type: 'upload',
            voice_type: remixConfig.voiceOption === 'avatar' ? 'avatar' : 'voiceover',
            voice_id: remixConfig.voiceId,
            avatar_type: remixConfig.avatarType,
            avatar_photo_url: remixConfig.avatarPhotoUrl,
            heygen_avatar_id: remixConfig.heygenAvatarId,
            character_id: remixConfig.characterId,
            lip_sync_provider: remixConfig.lipSyncProvider,
            b_roll_enabled: remixConfig.bRollEnabled,
            b_roll_style: remixConfig.bRollStyle,
            subtitle_style: remixConfig.subtitleStyle,
            orientation: remixConfig.orientation,
            template_type: blueprint.model_config?.remix_template_type || remixConfig.templateType,
            max_screenshots: remixConfig.maxFrames,
            background_music_url: remixConfig.backgroundMusicUrl,
          } : {}),
          // Unified video pipeline config
          ...(blueprint.pipeline === 'video' && unifiedVideoConfig ? {
            video_config: {
              ...(preRecordedEditorState ? {
                screen_video_url: preRecordedEditorState.screenVideoUrl,
                webcam_video_url: preRecordedEditorState.webcamVideoUrl,
              } : {}),
              source: unifiedVideoConfig.source,
              source_url: unifiedVideoConfig.sourceUrl,
              uploaded_video_url: unifiedVideoConfig.uploadedVideoUrl,
              uploaded_image_urls: unifiedVideoConfig.uploadedImageUrls,
              narration_mode: unifiedVideoConfig.narrationMode,
              rewrite_style: unifiedVideoConfig.rewriteStyle,
              target_language: unifiedVideoConfig.targetLanguage,
              custom_rewrite_instructions: unifiedVideoConfig.customRewriteInstructions,
              target_duration: unifiedVideoConfig.targetDuration,
              voice_mode: unifiedVideoConfig.voiceMode,
              lip_sync_provider: unifiedVideoConfig.lipSyncProvider,
              avatar_photo_url: unifiedVideoConfig.avatarPhotoUrl,
              heygen_avatar_id: unifiedVideoConfig.heygenAvatarId,
              image_mode: unifiedVideoConfig.imageMode,
              b_roll_enabled: unifiedVideoConfig.bRollEnabled,
              b_roll_style: unifiedVideoConfig.bRollStyle,
              orientation: unifiedVideoConfig.orientation,
              aspect_ratio: unifiedVideoConfig.aspectRatio,
              subtitle_style: unifiedVideoConfig.subtitleStyle,
              background_music_url: unifiedVideoConfig.backgroundMusicUrl,
              background_music_volume: unifiedVideoConfig.backgroundMusicVolume,
              transition_type: unifiedVideoConfig.transitionType,
            },
            // Top-level fields for handler compatibility
            source: unifiedVideoConfig.source,
            voice_mode: unifiedVideoConfig.voiceMode,
            voice_type: unifiedVideoConfig.voiceMode === 'avatar' ? 'avatar' : 'voiceover',
            b_roll_enabled: unifiedVideoConfig.bRollEnabled,
            b_roll_style: unifiedVideoConfig.bRollStyle,
            subtitle_style: unifiedVideoConfig.subtitleStyle,
            orientation: unifiedVideoConfig.orientation,
            lip_sync_provider: unifiedVideoConfig.lipSyncProvider,
            background_music_url: unifiedVideoConfig.backgroundMusicUrl,
          } : {}),
        },
      };

      // Show loading feedback immediately
      const loadingToastId = toast.loading('Creating generation job...');

      try {
        createJob(jobConfig, {
          onSuccess: (jobId) => {
            toast.success(`Generation job created with ${items.length} items!`);
            // Navigate immediately - dispatch happens in background
            navigate(`/jobs/${jobId}`);
          },
          onError: (error) => {
            toast.error(`Failed to create job: ${error.message}`);
          },
          onSettled: () => {
            // Always dismiss loading toast to prevent stuck toasts
            toast.dismiss(loadingToastId);
          },
        });
      } catch (jobError) {
        // Handle synchronous errors from createJob
        toast.dismiss(loadingToastId);
        throw jobError;
      }

    } catch (error) {
      console.error('Error in handleGenerate:', error);
      toast.error(`Failed to prepare generation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [blueprint, updatedIdeaRows, pinnedLibraryElements, libraryData, videoConfig, outputConfig, presenterConfig, remixConfig, unifiedVideoConfig, customPrompt, customImagePrompt, hasConfirmedReview, autoApproveAll, bulkCreateIdeas, createJob, navigate, ideaAiInsights, ideaAiAnalysis]);

  // Register generation handler with parent
  useEffect(() => {
    if (onGenerate && hasConfirmedReview) {
      onGenerate(handleGenerate);
    }
  }, [onGenerate, handleGenerate, hasConfirmedReview]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
          <Zap className="h-8 w-8 text-cta" />
          Review & Generate
        </h1>
        <p className="text-muted-foreground text-lg">
          Review your configuration and start content generation
        </p>
      </div>

      <MissingApiKeyAlert pipeline={blueprint.pipeline} contextLabel="generate" />

      {/* Blueprint Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            Blueprint
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{blueprint.name}</div>
                {blueprint.description && (
                  <div className="text-sm text-muted-foreground mt-1">
                    {blueprint.description}
                  </div>
                )}
              </div>
              {blueprint.pipeline && <Badge variant="secondary">{formatLabel(blueprint.pipeline)}</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recording Summary */}
      {preRecordedEditorState && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Screen Recording
            </CardTitle>
            <CardDescription>
              Video will be transcribed, narration improved, and visuals directed by the pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm">
              <Badge variant="secondary">
                {preRecordedEditorState.screenWidth}x{preRecordedEditorState.screenHeight}
              </Badge>
              <Badge variant="secondary">
                {preRecordedEditorState.screenHeight > preRecordedEditorState.screenWidth ? 'Portrait' : 'Landscape'}
              </Badge>
              <Badge variant="secondary">
                {Math.round(preRecordedEditorState.durationSeconds)}s
              </Badge>
              {preRecordedEditorState.webcamVideoUrl && (
                <Badge variant="outline">Webcam</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pipeline Output Preview */}
      {pipelineOutput && pipelineOutput.stageFlow.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Film className="h-5 w-5" />
              What This Will Produce
            </CardTitle>
            <CardDescription>
              {pipelineOutput.shortLabel} — {pipelineOutput.stageFlow.length} stages
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center flex-wrap gap-2">
              {pipelineOutput.stageFlow.map((stage, idx) => {
                const modelKey = stage.modelType && stage.modelType !== 'assembly'
                  ? stage.modelType as keyof typeof blueprint.model_config
                  : null;
                const modelConfig = modelKey ? blueprint.model_config?.[modelKey] : null;
                const hasModel = modelConfig && typeof modelConfig === 'object' && 'model_id' in modelConfig;
                const isMissingModel = modelKey && !hasModel;

                return (
                  <div key={stage.id} className="flex items-center gap-2">
                    {idx > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />}
                    <div className="flex flex-col items-center">
                      <Badge
                        variant={stage.modelType === 'assembly' ? 'default' : 'secondary'}
                        className={cn(
                          "text-xs whitespace-nowrap",
                          isMissingModel && "border-dashed border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/20"
                        )}
                      >
                        {stage.label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground mt-0.5">
                        {stage.type}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Models Configuration */}
      {blueprint.model_config && Object.keys(blueprint.model_config).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Cpu className="h-5 w-5" />
              AI Models
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(blueprint.model_config).map(([modelType, config]) => {
                // Skip legacy fields and non-model config keys
                if (SKIP_MODEL_CONFIG_KEYS.includes(modelType)) {
                  return null;
                }

                const modelConfig = config as { provider: string; model_id: string };

                // Skip if no valid model config (provider + model_id)
                if (!modelConfig?.provider || !modelConfig?.model_id) {
                  return null;
                }

                const label = MODEL_TYPE_LABELS[modelType] || formatLabel(modelType);

                return (
                  <div key={modelType} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {modelConfig.provider}
                      </Badge>
                      <div className="text-sm text-muted-foreground font-mono max-w-[300px] truncate">
                        {modelConfig.model_id}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ideas Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="h-5 w-5" />
            {blueprint.pipeline === 'video_remix' ? 'Source Videos' : blueprint.pipeline === 'presenter_video' ? 'Source Pages' : 'Ideas'} ({ideaRows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {ideaRows.map((row, idx) => (
              <div key={idx} className="text-sm p-2 bg-muted rounded">
                {blueprint.pipeline === 'presenter_video' ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs capitalize">{row.sourceType || 'url'}</Badge>
                      {row.sourceType === 'url' || !row.sourceType ? (
                        <span className="text-xs text-muted-foreground truncate">{row.sourceUrl || 'No URL'}</span>
                      ) : row.sourceType === 'upload' ? (
                        <span className="text-xs text-muted-foreground">{row.uploadedVideoUrl ? 'Video uploaded' : 'No video'}</span>
                      ) : null}
                    </div>
                    {row.context && <div className="text-xs text-muted-foreground">{row.context}</div>}
                  </div>
                ) : (
                  row.context
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Video Configuration Summary - Only show for video pipelines */}
      {videoConfig && VIDEO_PIPELINES.includes(blueprint.pipeline || '') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Film className="h-5 w-5" />
              Video Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Target Duration</div>
                <div className="font-medium">{videoConfig.totalDuration} seconds</div>
              </div>
              <div>
                <div className="text-muted-foreground">Aspect Ratio</div>
                <div className="font-medium capitalize">{videoConfig.aspectRatio} ({ASPECT_RATIO_DIMENSIONS[videoConfig.aspectRatio]})</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Scene count will be calculated automatically based on voiceover duration (5s per scene).
            </p>
          </CardContent>
        </Card>
      )}

      {/* Output Configuration Summary - Only show for visual (non-video) pipelines */}
      {outputConfig && VISUAL_PIPELINES.includes(blueprint.pipeline || '') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Image className="h-5 w-5" />
              Output Format
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm">
              <div className="text-muted-foreground">Aspect Ratio</div>
              <div className="font-medium capitalize">{outputConfig.aspectRatio} ({ASPECT_RATIO_DIMENSIONS[outputConfig.aspectRatio]})</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Presenter Video Settings Summary */}
      {blueprint.pipeline === 'presenter_video' && presenterConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Film className="h-5 w-5" />
              Presenter Video Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Voice Type</div>
                <div className="font-medium capitalize">{formatLabel(presenterConfig.voiceType || 'voiceover')}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Orientation</div>
                <div className="font-medium capitalize">{presenterConfig.orientation || 'portrait'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Subtitles</div>
                <div className="font-medium capitalize">{formatLabel(presenterConfig.subtitleStyle || 'tiktok_bounce')}</div>
              </div>
              {presenterConfig.bRollEnabled && (
                <div>
                  <div className="text-muted-foreground">B-Roll</div>
                  <div className="font-medium capitalize">{presenterConfig.bRollStyle === 'ai_generated' ? 'AI Generated' : 'Stock Footage'}</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unified Video Settings Summary */}
      {blueprint.pipeline === 'video' && unifiedVideoConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Film className="h-5 w-5" />
              Video Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Source</div>
                <div className="font-medium capitalize">{formatLabel(unifiedVideoConfig.source)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Narration</div>
                <div className="font-medium capitalize">{formatLabel(unifiedVideoConfig.narrationMode)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Voice</div>
                <div className="font-medium capitalize">{formatLabel(unifiedVideoConfig.voiceMode)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Orientation</div>
                <div className="font-medium capitalize">{unifiedVideoConfig.orientation}</div>
              </div>
              {unifiedVideoConfig.imageMode === 'ai_generated' && (
                <div>
                  <div className="text-muted-foreground">AI Images</div>
                  <div className="font-medium">Enabled</div>
                </div>
              )}
              {unifiedVideoConfig.bRollEnabled && (
                <div>
                  <div className="text-muted-foreground">B-Roll</div>
                  <div className="font-medium capitalize">{unifiedVideoConfig.bRollStyle === 'ai_generated' ? 'AI Generated' : 'Stock Footage'}</div>
                </div>
              )}
              {unifiedVideoConfig.narrationMode === 'rewrite' && unifiedVideoConfig.rewriteStyle && (
                <div>
                  <div className="text-muted-foreground">Rewrite Style</div>
                  <div className="font-medium capitalize">{formatLabel(unifiedVideoConfig.rewriteStyle)}</div>
                </div>
              )}
              {unifiedVideoConfig.targetDuration && (
                <div>
                  <div className="text-muted-foreground">Target Duration</div>
                  <div className="font-medium">{unifiedVideoConfig.targetDuration}s</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Library Elements Summary */}
      {Object.keys(pinnedLibraryElements).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Library className="h-5 w-5" />
              Library Elements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(pinnedLibraryElements).map(([libraryTable, config]) => {
                const elementIds = Object.keys(config.elements);
                if (elementIds.length === 0) return null;

                const label = LIBRARY_TABLE_LABELS[libraryTable] || libraryTable;

                return (
                  <div key={libraryTable}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm">{label}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{elementIds.length} selected</Badge>
                        <Badge variant={config.combination_mode === 'combine' ? 'default' : 'outline'}>
                          {config.combination_mode === 'combine' ? 'Mix together' : 'Separate versions'}
                        </Badge>
                      </div>
                    </div>
                    
                    {/* Show included field count if any */}
                    {elementIds.some(id => Object.keys(config.elements[id].paths || {}).length > 0) && (
                      <div className="ml-4 text-xs text-muted-foreground">
                        {Object.values(config.elements).reduce((sum, el) => 
                          sum + Object.values(el.paths || {}).filter(p => p.included).length, 0
                        )} fields included (all combined)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Master Prompt Template - Hide for image_only pipeline */}
      {!IMAGE_ONLY_PIPELINES.includes(blueprint.pipeline || '') && (
        <Card className="border-cta/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Master Prompt
                </CardTitle>
                <CardDescription>The main prompt template for content generation</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="customize-prompt"
                  checked={isCustomizing}
                  onCheckedChange={(checked) => {
                    setIsCustomizing(checked);
                    if (!checked) {
                      setPromptDraft(blueprint.master_prompt || "");
                    }
                  }}
                />
                <Label htmlFor="customize-prompt" className="cursor-pointer">
                  Customize
                </Label>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isCustomizing ? (
              <div className="space-y-3">
                <Textarea
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  className="min-h-[200px] font-mono text-sm"
                  placeholder="Edit the prompt template..."
                />
                <p className="text-xs text-muted-foreground">
                  Changes will only apply to this generation run and won't modify the saved blueprint.
                </p>
              </div>
            ) : (
              <div className="rounded-lg bg-muted/50 p-4 border">
                <PromptPreview
                  prompt={customPrompt || blueprint.master_prompt || ""}
                  ideaContext={ideaRows[0]?.context}
                  ideaFreeText={firstIdeaFreeText}
                  pinnedLibraryElements={pinnedLibraryElements}
                  libraryData={libraryData}
                  ideaAiAnalysis={ideaAiAnalysis}
                  outputConfig={previewOutputConfig}
                />
              </div>
            )}

            {/* Resolved Prompt Preview - Shows actual values */}
            <ResolvedPromptPreview
              promptTemplate={customPrompt || blueprint.master_prompt || ""}
              ideaRows={ideaRows}
              pinnedLibraryElements={pinnedLibraryElements}
              libraryData={libraryData}
              ideaAiAnalysis={ideaAiAnalysis}
              videoConfig={videoConfig}
              outputConfig={previewOutputConfig}
              maxSamples={3}
              title="See how variables will be resolved"
            />
          </CardContent>
        </Card>
      )}

      {/* Image Prompt Template - Only show if actually used: image pipelines, or video pipeline with AI images enabled */}
      {(blueprint.pipeline !== 'video'
        ? (blueprint.image_prompt || VISUAL_PIPELINES.includes(blueprint.pipeline || '') || VIDEO_PIPELINES.includes(blueprint.pipeline || ''))
        : (unifiedVideoConfig?.imageMode === 'ai_generated' && blueprint.image_prompt)
      ) && (
        <Card className={IMAGE_ONLY_PIPELINES.includes(blueprint.pipeline || '') ? "border-cta/20" : "border-orange-500/20"}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className={`h-5 w-5 ${IMAGE_ONLY_PIPELINES.includes(blueprint.pipeline || '') ? "" : "text-orange-500"}`} />
                  {IMAGE_ONLY_PIPELINES.includes(blueprint.pipeline || '') ? "Image Generation Prompt" : "Image Prompt"}
                </CardTitle>
                <CardDescription>
                  {IMAGE_ONLY_PIPELINES.includes(blueprint.pipeline || '')
                    ? "The prompt template that will be sent to the image generator"
                    : blueprint.image_prompt
                      ? "Template used for image generation stages"
                      : "No custom image prompt defined - images will be auto-generated from captions"
                  }
                </CardDescription>
              </div>
              {blueprint.image_prompt && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="customize-image-prompt"
                    checked={isCustomizingImagePrompt}
                    onCheckedChange={(checked) => {
                      setIsCustomizingImagePrompt(checked);
                      if (!checked) {
                        setImagePromptDraft(blueprint.image_prompt || "");
                      }
                    }}
                  />
                  <Label htmlFor="customize-image-prompt" className="cursor-pointer">
                    Customize
                  </Label>
                </div>
              )}
            </div>
          </CardHeader>
          {blueprint.image_prompt && (
            <CardContent className="space-y-4">
              {isCustomizingImagePrompt ? (
                <div className="space-y-3">
                  <Textarea
                    value={imagePromptDraft}
                    onChange={(e) => setImagePromptDraft(e.target.value)}
                    className="min-h-[200px] font-mono text-sm"
                    placeholder="Edit the image prompt template..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Changes will only apply to this generation run and won't modify the saved blueprint.
                  </p>
                </div>
              ) : (
                <div className={`rounded-lg p-4 border ${IMAGE_ONLY_PIPELINES.includes(blueprint.pipeline || '') ? "bg-muted/50" : "bg-orange-500/5 border-orange-500/20"}`}>
                  <PromptPreview
                    prompt={customImagePrompt || blueprint.image_prompt}
                    ideaContext={ideaRows[0]?.context}
                    ideaFreeText={firstIdeaFreeText}
                    pinnedLibraryElements={pinnedLibraryElements}
                    libraryData={libraryData}
                    ideaAiAnalysis={ideaAiAnalysis}
                    outputConfig={previewOutputConfig}
                  />
                </div>
              )}

              {/* Resolved Image Prompt Preview */}
              <ResolvedPromptPreview
                promptTemplate={customImagePrompt || blueprint.image_prompt}
                ideaRows={ideaRows}
                pinnedLibraryElements={pinnedLibraryElements}
                libraryData={libraryData}
                ideaAiAnalysis={ideaAiAnalysis}
                videoConfig={videoConfig}
                outputConfig={previewOutputConfig}
                maxSamples={IMAGE_ONLY_PIPELINES.includes(blueprint.pipeline || '') ? 3 : 2}
                title="See how image prompt will be resolved"
                className={IMAGE_ONLY_PIPELINES.includes(blueprint.pipeline || '') ? "" : "border-orange-500/20"}
              />
            </CardContent>
          )}
        </Card>
      )}

      {/* Director Prompt Template - Only show for video pipelines with director stages */}
      {DIRECTOR_PIPELINES.includes(blueprint.pipeline || '') && blueprint.director_prompt && (
        <Card className="border-purple-500/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Film className="h-5 w-5 text-purple-500" />
                  Director Prompt
                </CardTitle>
                <CardDescription>
                  Creative direction for the video director stage — controls shot breakdown and visual storytelling
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="customize-director-prompt"
                  checked={isCustomizingDirectorPrompt}
                  onCheckedChange={(checked) => {
                    setIsCustomizingDirectorPrompt(checked);
                    if (!checked) {
                      setDirectorPromptDraft(blueprint.director_prompt || "");
                    }
                  }}
                />
                <Label htmlFor="customize-director-prompt" className="cursor-pointer">
                  Customize
                </Label>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isCustomizingDirectorPrompt ? (
              <div className="space-y-3">
                <Textarea
                  value={directorPromptDraft}
                  onChange={(e) => setDirectorPromptDraft(e.target.value)}
                  className="min-h-[200px] font-mono text-sm"
                  placeholder="Edit the director prompt template..."
                />
                <p className="text-xs text-muted-foreground">
                  Changes will only apply to this generation run and won't modify the saved blueprint.
                </p>
              </div>
            ) : (
              <div className="rounded-lg p-4 border bg-purple-500/5 border-purple-500/20">
                <PromptPreview
                  prompt={customDirectorPrompt || blueprint.director_prompt}
                  ideaContext={ideaRows[0]?.context}
                  ideaFreeText={firstIdeaFreeText}
                  pinnedLibraryElements={pinnedLibraryElements}
                  libraryData={libraryData}
                  ideaAiAnalysis={ideaAiAnalysis}
                  outputConfig={previewOutputConfig}
                />
              </div>
            )}

            {/* Resolved Director Prompt Preview */}
            <ResolvedPromptPreview
              promptTemplate={customDirectorPrompt || blueprint.director_prompt}
              ideaRows={ideaRows}
              pinnedLibraryElements={pinnedLibraryElements}
              libraryData={libraryData}
              ideaAiAnalysis={ideaAiAnalysis}
              videoConfig={videoConfig}
              outputConfig={previewOutputConfig}
              maxSamples={2}
              title="See how director prompt will be resolved"
              className="border-purple-500/20"
            />
          </CardContent>
        </Card>
      )}

      {/* Visual References Section */}
      <VisualReferencesSection
        pinnedElements={pinnedLibraryElements}
        libraryData={libraryData}
        blueprint={blueprint}
      />

      {/* Visual Variation Calculator */}
      <Card className="border-cta/20 bg-cta/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="h-5 w-5 text-cta" />
            Generation Preview
          </CardTitle>
          <CardDescription>
            How your ideas, AI insights, and library elements combine to create outputs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Visual equation */}
            <div className="flex items-center flex-wrap gap-2 p-3 bg-background rounded-lg border">
              {/* Ideas with AI insight variations */}
              <div className="flex flex-col items-center">
                <Badge variant="secondary" className="text-base px-3 py-1">
                  {variationBreakdown.totalIdeaVariations}
                </Badge>
                <span className="text-xs text-muted-foreground mt-1">
                  {variationBreakdown.totalIdeaVariations === 1 ? 'Idea variant' : 'Idea variants'}
                </span>
                {variationBreakdown.totalIdeaVariations !== variationBreakdown.ideaCount && (
                  <span className="text-xs text-muted-foreground">
                    ({variationBreakdown.ideaCount} {variationBreakdown.ideaCount === 1 ? 'idea' : 'ideas'} × AI variations)
                  </span>
                )}
              </div>

              {/* Multiplication signs and library elements */}
              {variationBreakdown.libraryBreakdown.map((lib, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  {lib.mode === 'separate' ? (
                    <X className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <span className="text-muted-foreground text-sm">+</span>
                  )}
                  <div className="flex flex-col items-center">
                    <Badge
                      variant={lib.mode === 'separate' ? 'default' : 'outline'}
                      className="text-base px-3 py-1"
                    >
                      {lib.count}
                    </Badge>
                    <span className="text-xs text-muted-foreground mt-1">
                      {lib.label}
                    </span>
                  </div>
                </div>
              ))}

              {/* Equals */}
              <div className="flex items-center gap-2 ml-2">
                <span className="text-muted-foreground font-bold">=</span>
                <div className="flex flex-col items-center">
                  <Badge className="text-lg px-4 py-1 bg-cta text-cta-foreground">
                    {variationBreakdown.totalVariations}
                  </Badge>
                  <span className="text-xs text-muted-foreground mt-1">
                    {variationBreakdown.totalVariations === 1 ? 'Output' : 'Outputs'}
                  </span>
                </div>
              </div>
            </div>

            {/* Detailed breakdown */}
            <div className="space-y-2">
              {/* Ideas list */}
              <div className="text-sm">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Layers className="h-3 w-3" />
                  <span className="font-medium">Ideas ({variationBreakdown.ideaCount}):</span>
                </div>
                <div className="ml-5 space-y-1">
                  {ideaRows.slice(0, 3).map((row, idx) => (
                    <div key={idx} className="text-xs bg-muted/50 px-2 py-1 rounded truncate">
                      {row.context.substring(0, 80)}{row.context.length > 80 ? '...' : ''}
                    </div>
                  ))}
                  {ideaRows.length > 3 && (
                    <div className="text-xs text-muted-foreground italic">
                      +{ideaRows.length - 3} more...
                    </div>
                  )}
                </div>
              </div>

              {/* AI Insight Variations - show when ideas have separate mode variations */}
              {variationBreakdown.aiInsightBreakdown.length > 0 && (
                <div className="text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Zap className="h-3 w-3" />
                    <span className="font-medium">AI Insight Variations:</span>
                    <Badge variant="default" className="text-xs h-5">
                      × multiplies
                    </Badge>
                  </div>
                  <div className="ml-5 space-y-2">
                    {variationBreakdown.aiInsightBreakdown.slice(0, 3).map((breakdown, idx) => (
                      <div key={idx} className="text-xs bg-muted/50 px-2 py-1.5 rounded">
                        <div className="font-medium truncate">{breakdown.ideaLabel}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {breakdown.hookCount > 0 && (
                            <Badge variant="outline" className="text-xs h-4">
                              {breakdown.hookCount} hooks
                            </Badge>
                          )}
                          {breakdown.talkingPointCount > 0 && (
                            <Badge variant="outline" className="text-xs h-4">
                              {breakdown.talkingPointCount} talking pts
                            </Badge>
                          )}
                          {breakdown.ctaCount > 0 && (
                            <Badge variant="outline" className="text-xs h-4">
                              {breakdown.ctaCount} CTAs
                            </Badge>
                          )}
                          <span className="text-muted-foreground">→ {breakdown.itemCount} variants</span>
                        </div>
                      </div>
                    ))}
                    {variationBreakdown.aiInsightBreakdown.length > 3 && (
                      <div className="text-xs text-muted-foreground italic">
                        +{variationBreakdown.aiInsightBreakdown.length - 3} more ideas with variations...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Library elements with names */}
              {variationBreakdown.libraryBreakdown.map((lib, idx) => {
                const libraryTable = Object.keys(pinnedLibraryElements).find(
                  table => LIBRARY_TABLE_LABELS[table] === lib.label
                );
                const elementIds = libraryTable ? Object.keys(pinnedLibraryElements[libraryTable].elements) : [];
                const elements = libraryTable ? (libraryData[libraryTable] || []).filter(el => elementIds.includes(el.id)) : [];

                return (
                  <div key={idx} className="text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Library className="h-3 w-3" />
                      <span className="font-medium">{lib.label}:</span>
                      <Badge variant={lib.mode === 'separate' ? 'default' : 'outline'} className="text-xs h-5">
                        {lib.mode === 'separate' ? '× multiplies' : '+ combines'}
                      </Badge>
                    </div>
                    <div className="ml-5 space-y-1">
                      {elements.slice(0, 3).map((el, elIdx) => (
                        <div key={elIdx} className="text-xs bg-muted/50 px-2 py-1 rounded truncate">
                          {el.name || el.title || 'Unnamed'}
                        </div>
                      ))}
                      {elements.length > 3 && (
                        <div className="text-xs text-muted-foreground italic">
                          +{elements.length - 3} more...
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Full Variation List */}
            {explodedItemsPreview.length > 0 && (
              <>
                <Separator />
                <Collapsible open={isVariationListExpanded} onOpenChange={setIsVariationListExpanded}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between px-0 h-auto py-2 hover:bg-transparent">
                      <span className="text-sm text-muted-foreground font-medium">
                        All {explodedItemsPreview.length} variation{explodedItemsPreview.length !== 1 ? 's' : ''} that will be generated
                      </span>
                      {isVariationListExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ScrollArea className={explodedItemsPreview.length > 5 ? "h-[400px]" : ""}>
                      <div className="space-y-2 pt-2">
                        {explodedItemsPreview.map((item, idx) => {
                          // Extract library element names
                          const libraryParts: { table: string; name: string }[] = [];
                          if (item.library_elements) {
                            Object.entries(item.library_elements).forEach(([table, element]) => {
                              if (Array.isArray(element)) {
                                // Combined mode - multiple elements
                                element.forEach(el => {
                                  libraryParts.push({
                                    table: LIBRARY_TABLE_LABELS[table] || table.replace('library_', ''),
                                    name: el.name || el.title || 'Unnamed'
                                  });
                                });
                              } else if (element) {
                                // Separate mode - single element
                                libraryParts.push({
                                  table: LIBRARY_TABLE_LABELS[table] || table.replace('library_', ''),
                                  name: element.name || element.title || 'Unnamed'
                                });
                              }
                            });
                          }

                          return (
                            <div key={idx} className="text-xs bg-muted/30 p-3 rounded-lg border border-muted">
                              <div className="flex items-start gap-2">
                                <Badge variant="secondary" className="shrink-0 h-5 min-w-[24px] justify-center">
                                  {idx + 1}
                                </Badge>
                                <div className="flex-1 space-y-2">
                                  {/* Idea */}
                                  <div className="flex items-start gap-2">
                                    <Lightbulb className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" />
                                    <span className="text-foreground">
                                      {item.slot_values?.idea?.substring(0, 100)}
                                      {(item.slot_values?.idea?.length || 0) > 100 ? '...' : ''}
                                    </span>
                                  </div>

                                  {/* AI Insights */}
                                  {item.selected_ai_insights && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {item.selected_ai_insights.hook && (
                                        <Badge variant="outline" className="text-xs h-5 gap-1 bg-cta/10 border-cta/30 text-cta dark:text-cta">
                                          <MessageSquare className="h-2.5 w-2.5" />
                                          Hook {(item.selected_ai_insights.hook.index ?? 0) + 1}: {item.selected_ai_insights.hook.text?.substring(0, 30)}...
                                        </Badge>
                                      )}
                                      {item.selected_ai_insights.talking_point && (
                                        <Badge variant="outline" className="text-xs h-5 gap-1 bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300">
                                          <MessageSquare className="h-2.5 w-2.5" />
                                          TP {(item.selected_ai_insights.talking_point.index ?? 0) + 1}: {item.selected_ai_insights.talking_point.text?.substring(0, 30)}...
                                        </Badge>
                                      )}
                                      {item.selected_ai_insights.cta && (
                                        <Badge variant="outline" className="text-xs h-5 gap-1 bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300">
                                          <Target className="h-2.5 w-2.5" />
                                          CTA: {item.selected_ai_insights.cta.text?.substring(0, 30)}...
                                        </Badge>
                                      )}
                                      {item.selected_ai_insights.talking_points && item.selected_ai_insights.talking_points.length > 0 && !item.selected_ai_insights.talking_point && (
                                        <Badge variant="outline" className="text-xs h-5 gap-1 bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300">
                                          <MessageSquare className="h-2.5 w-2.5" />
                                          {item.selected_ai_insights.talking_points.length} talking points (combined)
                                        </Badge>
                                      )}
                                    </div>
                                  )}

                                  {/* Library Elements */}
                                  {libraryParts.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {libraryParts.map((part, partIdx) => (
                                        <Badge key={partIdx} variant="outline" className="text-xs h-5 gap-1">
                                          <Library className="h-2.5 w-2.5" />
                                          {part.table}: {part.name}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Variable Validation Status */}
      {promptValidation.hasWarnings ? (
        <Alert variant="destructive" className="border-yellow-500/50 bg-yellow-500/10 text-yellow-800 dark:text-yellow-200">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some variables won't have data</AlertTitle>
          <AlertDescription className="mt-2">
            <div className="space-y-2">
              {promptValidation.warnings.map((warning, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className="font-mono text-xs border-yellow-500/50 shrink-0">
                    {`{{${warning.variable}}}`}
                  </Badge>
                  <div className="flex flex-col">
                    <span className="text-yellow-700 dark:text-yellow-300">{warning.message}</span>
                    <span className="text-xs text-yellow-600/80 dark:text-yellow-400/80">
                      {warning.status === 'missing_selection'
                        ? '→ Go back to Library step and select this element type'
                        : '→ Check that selected items have this field filled in'
                      }
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 p-2 bg-yellow-500/10 rounded text-xs">
              <strong>What happens if you proceed:</strong> These variables will show as "[Not provided]" in your generated content, which may look broken or incomplete.
            </div>
          </AlertDescription>
        </Alert>
      ) : promptValidation.resolved.length > 0 && (
        <Alert className="border-green-500/50 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800 dark:text-green-200">All variables will resolve correctly</AlertTitle>
          <AlertDescription className="text-green-700 dark:text-green-300">
            <div className="flex flex-wrap gap-1 mt-2">
              {promptValidation.resolved.slice(0, 8).map((v, idx) => (
                <Badge key={idx} variant="outline" className="font-mono text-xs border-green-500/50 text-green-700 dark:text-green-300">
                  {`{{${v.variable}}}`}
                </Badge>
              ))}
              {promptValidation.resolved.length > 8 && (
                <span className="text-xs text-green-600">+{promptValidation.resolved.length - 8} more</span>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Voice Configuration Warning for TTS Pipelines */}
      {voiceValidation && voiceValidation.status === 'warning' && (
        <Alert variant="default" className="border-orange-500/50 bg-orange-500/10">
          <Mic className="h-4 w-4 text-orange-600" />
          <AlertTitle className="text-orange-800 dark:text-orange-200">Voice configuration needed</AlertTitle>
          <AlertDescription className="mt-2 space-y-2 text-orange-700 dark:text-orange-300">
            <p>{voiceValidation.message}</p>
            {voiceValidation.actionMessage && (
              <p className="text-sm text-orange-600/80 dark:text-orange-400/80">
                {voiceValidation.actionMessage}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {voiceValidation && voiceValidation.status === 'resolved' && voiceValidation.voiceSource === 'character' && (
        <Alert className="border-green-500/50 bg-green-500/10">
          <Mic className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800 dark:text-green-200">Voice configured{voiceValidation.voiceName ? `: ${voiceValidation.voiceName}` : ''}</AlertTitle>
          <AlertDescription className="text-green-700 dark:text-green-300">
            {voiceValidation.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Auto-Approve Toggle */}
      <Card className="border-blue-500/20 bg-blue-500/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-5 w-5 text-blue-500" />
                <Label htmlFor="auto-approve-all" className="text-base font-medium cursor-pointer">
                  Auto-Approve All Stages
                </Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Skip manual approval for all pipeline stages. Content will be generated end-to-end automatically.
              </p>
              {autoApproveAll && (
                <Alert className="mt-3 border-blue-500/30 bg-blue-500/10">
                  <Zap className="h-4 w-4 text-blue-500" />
                  <AlertDescription className="text-blue-700 dark:text-blue-300 text-sm">
                    All stages will be auto-approved as they complete. You can still review and edit outputs after generation finishes.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <Switch
              id="auto-approve-all"
              checked={autoApproveAll}
              onCheckedChange={onAutoApproveAllChange}
              className="data-[state=checked]:bg-blue-500"
            />
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Checkbox - Must be last */}
      <Card className="border-cta/30 bg-cta/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Checkbox
              id="confirm-review"
              checked={hasConfirmedReview}
              onCheckedChange={(checked) => onHasConfirmedReviewChange(!!checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <Label
                htmlFor="confirm-review"
                className="text-base font-medium cursor-pointer leading-tight"
              >
                I've reviewed the configuration and I'm ready to generate
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                Check this box to enable the "Generate Content" button. This will create {variationBreakdown.totalVariations} content output{variationBreakdown.totalVariations !== 1 ? 's' : ''}.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
