import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, Mic2, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useApiKeys } from "@/hooks/useApiKeys";
import { supabase } from "@/integrations/supabase/client";
import { useImageModels } from "@/hooks/useReplicateModels";
import { useElevenLabsModels } from "@/hooks/useElevenLabsModels";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { useAlibabaModels } from "@/hooks/useAlibabaModels";
import type { BlueprintModelConfig, ModelConfig } from "@/types/blueprint";
import type { PipelineId, ModelType } from "@/types/pipeline";
import { PIPELINES, MODEL_TYPE_LABELS } from "@/types/pipeline";

interface ModelSelectorProps {
  value: BlueprintModelConfig;
  onChange: (value: BlueprintModelConfig) => void;
  pipeline?: PipelineId;
}

// Recommended models (patterns for flexible matching)
// `…-405b:free` badges only the free Nous Hermes 3 model, not the paid `…-405b`.
const RECOMMENDED_LLM_PATTERNS = ['claude-sonnet-4.5', 'claude-4.5-sonnet', 'hermes-3-llama-3.1-405b:free'];
const RECOMMENDED_IMAGE_PATTERNS = ['gpt-5-image', 'gemini-3-pro-image', 'nano-banana-pro', 'flux.2-pro'];
const RECOMMENDED_T2V_PATTERNS = ['google/veo-3', 'veo-3'];
const RECOMMENDED_TTS_PATTERNS = ['eleven_v3', 'v3_alpha', 'eleven-v3', 'eleven v3', 'v3 (alpha)'];

// Helper to check if model ID or name matches any recommended pattern
const isRecommendedModel = (modelId: string, patterns: string[], modelName?: string): boolean => {
  const id = modelId.toLowerCase();
  const name = modelName?.toLowerCase() || '';
  return patterns.some(pattern => {
    const p = pattern.toLowerCase();
    return id.includes(p) || name.includes(p);
  });
};

// Fallback models if API fetch fails
const FALLBACK_TEXT_LLM_MODELS = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', recommended: true },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
];

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
}

interface ModelOption {
  id: string;
  name: string;
  description?: string;
  recommended?: boolean;
}

// Fallback only — live list is fetched from OpenRouter via get-ai-models
const IMAGE_GENERATOR_MODELS = [
  { id: 'openai/gpt-5-image', name: 'GPT-5 Image (best text rendering)', description: 'OpenAI — accurate in-image text for headlines, CTAs, prices', recommended: true },
  { id: 'google/gemini-3-pro-image-preview', name: 'Nano Banana Pro (Gemini 3 Pro Image)', recommended: true },
  { id: 'google/gemini-3.1-flash-image-preview', name: 'Nano Banana 2 (Gemini 3.1 Flash Image)' },
  { id: 'google/gemini-2.5-flash-image', name: 'Nano Banana (Gemini 2.5 Flash Image)' },
  { id: 'black-forest-labs/flux.2-pro', name: 'FLUX.2 Pro' },
  { id: 'black-forest-labs/flux.2-max', name: 'FLUX.2 Max' },
  { id: 'black-forest-labs/flux.2-flex', name: 'FLUX.2 Flex' },
  { id: 'openai/gpt-5-image-mini', name: 'GPT-5 Image Mini' },
  { id: 'bytedance-seed/seedream-4.5', name: 'Seedream 4.5' },
  { id: 'sourceful/riverflow-v2-pro', name: 'Riverflow V2 Pro' },
];

// Direct-OpenAI image models — used when provider='openai' is selected on
// image_generator. These hit api.openai.com/v1/responses directly (not via
// OpenRouter), using the image_generation tool. Required for native multiturn
// carousels: each slide passes the previous slide's response id
// (previous_response_id), so the model retains the full thread and keeps
// characters, style, and composition consistent across the deck.
const OPENAI_DIRECT_IMAGE_MODELS: ModelOption[] = [
  {
    id: 'gpt-image-2.5-flare',
    name: 'GPT Image 2.5 Flare (fast, high quality — recommended)',
    description: 'OpenAI’s default general-purpose image model as of Sep 2026: higher quality than GPT Image 2 at ~50% lower latency. Also supports native multiturn threading via previous_response_id.',
    recommended: true,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5 (native multiturn — consistent carousels)',
    description: 'OpenAI Responses API. Each slide is threaded to the previous one, keeping characters and style consistent across the whole deck.',
  },
];

const TTS_MODELS = [
  { id: 'eleven_alpha_3', name: 'Eleven Alpha 3', recommended: true },
  { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2' },
  { id: 'eleven_turbo_v2_5', name: 'Eleven Turbo v2.5' },
  { id: 'eleven_turbo_v2', name: 'Eleven Turbo v2' },
];

const WORLD_SIMULATOR_MODELS = [
  { id: 'google/veo-2', name: 'Google Veo 2', provider: 'replicate' },
  { id: 'openai/sora-2', name: 'OpenAI Sora 2', provider: 'replicate' },
];

export function ModelSelector({ value, onChange, pipeline }: ModelSelectorProps) {
  const selectedPipeline = pipeline ? PIPELINES.find(p => p.id === pipeline) : null;
  const requiredModels = selectedPipeline?.requiredModels || [];
  const optionalModels = selectedPipeline?.optionalModels || [];
  
  const { data: apiKeys } = useApiKeys();
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>([]);
  const [openRouterImageModels, setOpenRouterImageModels] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isLoadingImageModels, setIsLoadingImageModels] = useState(false);

  // Fetch video models from database (curated, need normalized_capabilities for execute-stage)
  const { data: videoModels, isLoading: isLoadingVideoModels } = useImageModels('text-to-video');
  const { data: ttsModels, isLoading: isLoadingTTSModels } = useElevenLabsModels();

  const openRouterKey = apiKeys?.find((k) => k.provider === "openrouter");
  const { data: ollamaModels = [], hasOllamaKey, isLoading: isLoadingOllamaModels } = useOllamaModels();
  const { data: alibabaModels = [], hasAlibabaKey, isLoading: isLoadingAlibabaModels } = useAlibabaModels();

  // Fetch OpenRouter LLM models when API key is available
  useEffect(() => {
    const fetchModels = async () => {
      if (!openRouterKey) return;

      setIsLoadingModels(true);
      try {
        const response = await fetch("https://openrouter.ai/api/v1/models");
        if (response.ok) {
          const data = await response.json();
          setOpenRouterModels(data.data || []);
        }
      } catch (error) {
        console.error("Failed to fetch OpenRouter models:", error);
      } finally {
        setIsLoadingModels(false);
      }
    };

    fetchModels();
  }, [openRouterKey]);

  // Fetch OpenRouter image generation models via edge function (proxied to avoid CORS)
  useEffect(() => {
    const fetchImageModels = async () => {
      if (!openRouterKey) return;

      setIsLoadingImageModels(true);
      try {
        const { data, error } = await supabase.functions.invoke('get-ai-models', {
          body: { source: 'openrouter' },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const models = (data?.models || []).map((m: any) => ({
          id: m.model_id,
          name: m.display_name,
          description: m.description || '',
          recommended: isRecommendedModel(m.model_id, RECOMMENDED_IMAGE_PATTERNS, m.display_name),
        }));
        setOpenRouterImageModels(models);
      } catch (error) {
        console.error("Failed to fetch OpenRouter image models:", error);
      } finally {
        setIsLoadingImageModels(false);
      }
    };

    fetchImageModels();
  }, [openRouterKey]);

  const updateModelConfig = (modelType: ModelType, config: ModelConfig) => {
    onChange({
      ...value,
      [modelType]: config,
    });
  };

  // Auto-set HeyGen model configs when API key is present (must be in useEffect, not during render)
  const heygenVideoConfigured = !!(value['heygen_video' as ModelType]?.model_id);
  const heygenTemplateConfigured = !!(value['heygen_template' as ModelType]?.model_id);
  useEffect(() => {
    const heygenKey = apiKeys?.find((k) => k.provider === 'heygen' && k.is_valid);
    if (!heygenKey) return;

    const needsVideo = !heygenVideoConfigured;
    const needsTemplate = !heygenTemplateConfigured;
    if (!needsVideo && !needsTemplate) return;

    const newValue = { ...value };
    if (needsVideo) {
      (newValue as Record<string, ModelConfig>)['heygen_video'] = {
        provider: 'heygen' as ModelConfig['provider'],
        model_id: 'heygen-avatar-v1',
        parameters: {},
      };
    }
    if (needsTemplate) {
      (newValue as Record<string, ModelConfig>)['heygen_template'] = {
        provider: 'heygen' as ModelConfig['provider'],
        model_id: 'heygen-template-v1',
        parameters: {},
      };
    }
    onChange(newValue);
  }, [apiKeys, heygenVideoConfigured, heygenTemplateConfigured]);

  const getModelsForType = (modelType: ModelType): ModelOption[] => {
    // Helper to sort recommended models first
    const sortByRecommended = (models: ModelOption[]): ModelOption[] =>
      [...models].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));

    switch (modelType) {
      case 'text_llm':
        // Ollama provider pinned on the blueprint → list the org's Ollama models
        if (value.text_llm?.provider === 'ollama') {
          return ollamaModels.map(m => ({
            id: m.id,
            name: m.name,
            description: m.description,
          }));
        }
        // Alibaba provider pinned on the blueprint → list the curated Qwen models
        if (value.text_llm?.provider === 'alibaba') {
          return alibabaModels.map(m => ({
            id: m.id,
            name: m.name,
            description: m.description,
          }));
        }
        // Use fetched OpenRouter models if available, otherwise fallback
        if (openRouterModels.length > 0) {
          const models = openRouterModels.map(m => ({
            id: m.id,
            name: m.name,
            description: m.description,
            recommended: isRecommendedModel(m.id, RECOMMENDED_LLM_PATTERNS, m.name)
          }));
          return sortByRecommended(models);
        }
        return sortByRecommended(FALLBACK_TEXT_LLM_MODELS);

      case 'image_generator': {
        // When provider=openai is pinned on the blueprint, surface direct-OpenAI
        // models (gpt-image-1, gpt-image-2). These run through the multiturn
        // carousel path. Anything else stays on the OpenRouter list.
        const provider = value.image_generator?.provider;
        if (provider === 'openai') {
          return OPENAI_DIRECT_IMAGE_MODELS;
        }
        if (openRouterImageModels.length > 0) {
          return sortByRecommended(openRouterImageModels);
        }
        return sortByRecommended(IMAGE_GENERATOR_MODELS);
      }

      case 'tts':
        // Use database models if available, otherwise fallback
        if (ttsModels && ttsModels.length > 0) {
          const models = ttsModels.map(m => ({
            id: m.id,
            name: m.name,
            description: m.description,
            recommended: isRecommendedModel(m.id, RECOMMENDED_TTS_PATTERNS, m.name)
          }));
          return sortByRecommended(models);
        }
        return sortByRecommended(TTS_MODELS);

      case 'world_simulator':
        // Use video models for world simulator (T2V models)
        if (videoModels && videoModels.length > 0) {
          const models = videoModels.map(m => ({
            id: m.modelId,
            name: m.displayName,
            description: m.description,
            recommended: isRecommendedModel(m.modelId, RECOMMENDED_T2V_PATTERNS, m.displayName)
          }));
          return sortByRecommended(models);
        }
        return sortByRecommended(WORLD_SIMULATOR_MODELS);

      case 'lip_sync':
        // Lip sync models - kept on Replicate
        return [
          { id: 'wav2lip', name: 'Wav2Lip' },
        ];

      case 'assembly':
        // Assembly doesn't need model selection
        return [];

      default:
        return [];
    }
  };

  const isLoadingModelsForType = (modelType: ModelType): boolean => {
    switch (modelType) {
      case 'text_llm':
        if (value.text_llm?.provider === 'ollama') return isLoadingOllamaModels;
        if (value.text_llm?.provider === 'alibaba') return isLoadingAlibabaModels;
        return isLoadingModels;
      case 'image_generator': return isLoadingImageModels;
      case 'tts': return isLoadingTTSModels;
      case 'world_simulator': return isLoadingVideoModels;
      default: return false;
    }
  };

  const getDefaultProvider = (modelType: ModelType): ModelConfig['provider'] => {
    switch (modelType) {
      case 'text_llm':
      case 'image_generator':
        return 'openrouter';
      case 'tts':
        return 'elevenlabs';
      case 'world_simulator':
        return 'replicate';
      default:
        return 'openrouter';
    }
  };

  // Track search queries per model type
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});

  // Check if a required model is properly configured
  const isModelConfigured = (modelType: ModelType): boolean => {
    // HeyGen types are configured if the API key exists
    if (modelType === 'heygen_video' || modelType === 'heygen_template') {
      return !!apiKeys?.find((k) => k.provider === 'heygen' && k.is_valid);
    }
    const config = value[modelType];
    return !!(config?.model_id && config.model_id.length > 0);
  };

  // Get missing required models
  const missingRequiredModels = requiredModels.filter(modelType => !isModelConfigured(modelType));

  // HeyGen model types don't have provider/model selection — avatar & voice are configured on the character
  const isHeyGenModelType = (modelType: ModelType): boolean =>
    modelType === 'heygen_video' || modelType === 'heygen_template';

  const renderHeyGenSection = (modelType: ModelType, isOptional: boolean = false) => {
    const heygenKey = apiKeys?.find((k) => k.provider === 'heygen' && k.is_valid);
    const isConfigured = !!heygenKey;
    const showError = !isOptional && !isConfigured;

    return (
      <div key={modelType} className={`space-y-4 p-4 rounded-lg border ${showError ? 'border-amber-500/50 bg-amber-500/5' : 'border-border/50 bg-muted/20'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-base font-medium">{MODEL_TYPE_LABELS[modelType]}</Label>
            {isOptional ? (
              <Badge variant="outline" className="text-xs">Optional</Badge>
            ) : isConfigured ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            )}
          </div>
        </div>

        <div className="rounded-md border border-border/50 bg-muted/30 p-4">
          {heygenKey ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">HeyGen API key connected</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {modelType === 'heygen_video'
                    ? 'Avatar and voice are configured on the character assigned to your blueprint.'
                    : 'Select a HeyGen template when configuring generation parameters.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">HeyGen API key required</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Add your HeyGen API key in Settings &rarr; Integrations to use this pipeline.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderModelSection = (modelType: ModelType, isOptional: boolean = false) => {
    // HeyGen types have a special rendering — no model selection needed
    if (isHeyGenModelType(modelType)) {
      return renderHeyGenSection(modelType, isOptional);
    }

    const currentConfig = value[modelType] || {
      provider: getDefaultProvider(modelType),
      model_id: '',
      parameters: {},
    };

    const availableModels = getModelsForType(modelType);
    const searchQuery = searchQueries[modelType] || '';

    // Filter models based on search
    const filteredModels = availableModels.filter((model) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        model.name.toLowerCase().includes(query) ||
        model.id.toLowerCase().includes(query) ||
        model.description?.toLowerCase().includes(query)
      );
    });

    const isConfigured = isModelConfigured(modelType);
    const showError = !isOptional && !isConfigured;

    return (
      <div key={modelType} className={`space-y-4 p-4 rounded-lg border ${showError ? 'border-amber-500/50 bg-amber-500/5' : 'border-border/50 bg-muted/20'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label className="text-base font-medium">{MODEL_TYPE_LABELS[modelType]}</Label>
            {isOptional ? (
              <Badge variant="outline" className="text-xs">Optional</Badge>
            ) : isConfigured ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${modelType}-provider`}>Provider</Label>
            <Select
              value={currentConfig.provider}
              onValueChange={(val) => updateModelConfig(modelType, {
                ...currentConfig,
                provider: val as ModelConfig['provider'],
                model_id: '',
              })}
            >
              <SelectTrigger id={`${modelType}-provider`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(modelType === 'text_llm' || modelType === 'image_generator') && <SelectItem value="openrouter">OpenRouter</SelectItem>}
                {modelType === 'text_llm' && hasOllamaKey && <SelectItem value="ollama">Ollama</SelectItem>}
                {modelType === 'text_llm' && hasAlibabaKey && <SelectItem value="alibaba">Alibaba (Qwen)</SelectItem>}
                {modelType === 'image_generator' && <SelectItem value="openai">OpenAI (multiturn carousels)</SelectItem>}
                {modelType === 'tts' && <SelectItem value="elevenlabs">ElevenLabs</SelectItem>}
                {modelType === 'world_simulator' && (
                  <SelectItem value="replicate">Replicate</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${modelType}-model`}>Model</Label>
            {isLoadingModelsForType(modelType) ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <div className="space-y-2">
                {/* Search input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search models..."
                    value={searchQuery}
                    onChange={(e) => setSearchQueries(prev => ({ ...prev, [modelType]: e.target.value }))}
                    className="pl-9 h-9"
                  />
                </div>
                {/* Model dropdown */}
                <Select
                  value={currentConfig.model_id}
                  onValueChange={(val) => updateModelConfig(modelType, {
                    ...currentConfig,
                    model_id: val,
                  })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent className="w-[600px]">
                    {filteredModels.length === 0 ? (
                      <div className="p-4 text-sm text-muted-foreground text-center">
                        {searchQuery ? `No models matching "${searchQuery}"` : "No models available"}
                      </div>
                    ) : (
                      filteredModels.map((model) => (
                        <SelectItem key={model.id} value={model.id} className="cursor-pointer py-3">
                          <div className="flex flex-col gap-1 pr-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{model.name}</span>
                              {model.recommended && (
                                <Badge className="text-xs bg-green-500/20 text-green-600 border-green-500/30">Recommended</Badge>
                              )}
                            </div>
                            {model.description && (
                              <span className="text-xs text-muted-foreground line-clamp-2 leading-tight">
                                {model.description}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* Text-rendering hint for image generators */}
        {modelType === 'image_generator' && (
          <p className="text-xs text-muted-foreground pt-1">
            For posts with in-image text (headlines, CTAs, prices), GPT-5 Image renders text most accurately.
          </p>
        )}

        {/* Voice info for TTS — voice is configured on characters, not blueprints */}
        {modelType === 'tts' && (
          <div className="pt-2 border-t border-border/30">
            <div className="rounded-md border border-border/50 bg-muted/30 p-3">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Voice is configured on your Character</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Pin a Library Character with a voice to set the voiceover voice.
                    If no character voice is set, the system default will be used.
                  </p>
                  {currentConfig.parameters?.voice_id && (
                    <p className="text-xs text-amber-500 mt-2">
                      This blueprint has a legacy voice setting that will be used as a
                      fallback if no character voice is configured.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  };

  if (!selectedPipeline) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-6 text-center text-muted-foreground">
        Please select a pipeline first
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={`rounded-lg border p-4 ${missingRequiredModels.length > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-green-500/30 bg-green-500/5'}`}>
        <div className="flex items-start gap-2 mb-2">
          {missingRequiredModels.length > 0 ? (
            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
          )}
          <div className="flex-1">
            <Label className="text-sm font-medium">
              {missingRequiredModels.length > 0
                ? `Select all required models for ${selectedPipeline.name}`
                : `All models configured for ${selectedPipeline.name}`
              }
            </Label>
            {missingRequiredModels.length > 0 && (
              <p className="text-xs text-amber-500 mt-1">
                Missing: {missingRequiredModels.map(m => MODEL_TYPE_LABELS[m]).join(', ')}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {requiredModels.map((modelType) => {
            const configured = isModelConfigured(modelType);
            return (
              <Badge
                key={modelType}
                variant={configured ? "default" : "outline"}
                className={`text-xs ${configured ? 'bg-green-500/20 text-green-700 border-green-500/30 hover:bg-green-500/30' : 'bg-amber-500/20 text-amber-700 border-amber-500/30 hover:bg-amber-500/30'}`}
              >
                {configured && <CheckCircle2 className="h-3 w-3 mr-1" />}
                {MODEL_TYPE_LABELS[modelType]}
              </Badge>
            );
          })}
          {optionalModels.map((modelType) => (
            <Badge key={modelType} variant="outline" className="text-xs">
              {MODEL_TYPE_LABELS[modelType]} (optional)
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {requiredModels.map((modelType) => renderModelSection(modelType, false))}
        {optionalModels.map((modelType) => renderModelSection(modelType, true))}
      </div>
    </div>
  );
}
