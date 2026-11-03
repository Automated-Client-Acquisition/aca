import { useState, useEffect } from "react";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { useUpdateDefaultModels } from "@/hooks/useUpdateDefaultModels";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useImageModels } from "@/hooks/useReplicateModels";
import { useElevenLabsModels } from "@/hooks/useElevenLabsModels";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { useAlibabaModels } from "@/hooks/useAlibabaModels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, AlertCircle, Loader2, Image, Mic, Film, RefreshCw } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
  context_length?: number;
}

// Recommended models
const RECOMMENDED_LLM_MODEL = 'anthropic/claude-sonnet-4.5';
const RECOMMENDED_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
const RECOMMENDED_T2V_MODEL = 'google/veo-3.1';
const RECOMMENDED_TTS_MODEL = 'eleven_alpha_3';

// Fallback models in case API fetch fails
const FALLBACK_IMAGE_GENERATORS = [
  { id: "google/gemini-3.1-flash-image-preview", name: "Nano Banana Pro (Gemini 3.1 Pro Image)", provider: "OpenRouter", recommended: true },
  { id: "google/gemini-2.5-flash-image", name: "Nano Banana (Gemini 2.5 Flash Image)", provider: "OpenRouter" },
  { id: "black-forest-labs/flux.2-pro", name: "FLUX.2 Pro", provider: "OpenRouter" },
  { id: "openai/gpt-5-image", name: "GPT-5 Image (best text rendering)", provider: "OpenRouter" },
];

const FALLBACK_WORLD_SIMULATOR_MODELS = [
  { id: "google/veo-3.1", name: "Google Veo 3.1", provider: "Replicate", recommended: true },
  { id: "openai/sora", name: "OpenAI Sora", provider: "Replicate" },
  { id: "google/veo-2", name: "Google Veo 2", provider: "Replicate" },
];

const FALLBACK_ELEVENLABS_MODELS = [
  { id: "eleven_alpha_3", name: "Eleven Alpha 3", recommended: true },
  { id: "eleven_multilingual_v2", name: "Eleven Multilingual v2" },
  { id: "eleven_turbo_v2_5", name: "Eleven Turbo v2.5" },
  { id: "eleven_turbo_v2", name: "Eleven Turbo v2" },
];

export function ModelSettings() {
  const { data: settings } = useOrganizationSettings();
  const { data: apiKeys } = useApiKeys();
  const updateModel = useUpdateDefaultModels();
  
  // Fetch dynamic models from providers
  const { data: imageT2IModels, isLoading: isLoadingImageT2I, refetch: refetchImageT2I } = useImageModels('text-to-image');
  const { data: replicateT2VModels, isLoading: isLoadingReplicateT2V, refetch: refetchReplicateT2V } = useImageModels('text-to-video');
  const { data: elevenLabsModels, isLoading: isLoadingELModels, refetch: refetchELModels } = useElevenLabsModels();
  const { data: ollamaModels } = useOllamaModels();
  const { data: alibabaModels } = useAlibabaModels();
  
  // State for each model type and loading states
  const [savingModel, setSavingModel] = useState<string | null>(null);
  
  const [selectedLlm, setSelectedLlm] = useState<string>("");
  const [selectedImageGen, setSelectedImageGen] = useState<string>("");
  const [selectedTts, setSelectedTts] = useState<string>("");
  const [selectedWorldSim, setSelectedWorldSim] = useState<string>("");
  
  const [availableModels, setAvailableModels] = useState<OpenRouterModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const openRouterKey = apiKeys?.find((k) => k.provider === "openrouter");
  const ollamaKey = apiKeys?.find((k) => k.provider === "ollama");
  const alibabaKey = apiKeys?.find((k) => k.provider === "alibaba");
  const elevenLabsKey = apiKeys?.find((k) => k.provider === "elevenlabs");
  const replicateKey = apiKeys?.find((k) => k.provider === "replicate");

  // Models from OpenRouter for images, Replicate for video - mark recommended models
  const mergedT2IModels = imageT2IModels?.map(m => ({
    id: m.id,
    name: m.displayName,
    provider: 'OpenRouter',
    recommended: m.modelId === RECOMMENDED_IMAGE_MODEL
  })) || [];
  const mergedT2VModels = replicateT2VModels?.map(m => ({
    id: m.id,
    name: m.displayName,
    provider: 'Replicate',
    recommended: m.modelId === RECOMMENDED_T2V_MODEL
  })) || [];

  const ttsModels = elevenLabsModels?.map(m => ({
    id: m.id,
    name: m.name,
    recommended: m.id === RECOMMENDED_TTS_MODEL
  })) || [];
  const llmModels = [
    // Ollama/Alibaba models (ids carry the `ollama:`/`alibaba:` prefix the backend routes on)
    ...(ollamaModels || []).map(m => ({
      id: m.id,
      name: `${m.name} (Ollama)`,
      description: m.description,
      recommended: false,
    })),
    ...(alibabaModels || []).map(m => ({
      id: m.id,
      name: `${m.name} (Alibaba)`,
      description: m.description,
      recommended: false,
    })),
    ...availableModels.map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      recommended: m.id === RECOMMENDED_LLM_MODEL
    })),
  ];
  
  // Determine which models list to use (dynamic or fallback), sort recommended first
  const sortByRecommended = <T extends { recommended?: boolean }>(models: T[]): T[] =>
    [...models].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));

  const imageGenerators = sortByRecommended(mergedT2IModels.length > 0 ? mergedT2IModels : FALLBACK_IMAGE_GENERATORS);
  const t2vModels = sortByRecommended(mergedT2VModels.length > 0 ? mergedT2VModels : FALLBACK_WORLD_SIMULATOR_MODELS);
  const elevenLabsModelsList = sortByRecommended(ttsModels.length > 0 ? ttsModels : FALLBACK_ELEVENLABS_MODELS);
  const sortedLlmModels = sortByRecommended(llmModels);

  useEffect(() => {
    if (settings) {
      setSelectedLlm(settings.default_llm_model || "");
      setSelectedImageGen(settings.default_image_generator_model || "");
      setSelectedTts(settings.default_tts_model || "");
      setSelectedWorldSim(settings.default_world_simulator_model || "");
    }
  }, [settings]);

  useEffect(() => {
    const fetchModels = async () => {
      if (!openRouterKey) return;
      
      setIsLoadingModels(true);
      try {
        const response = await fetch("https://openrouter.ai/api/v1/models");
        if (response.ok) {
          const data = await response.json();
          setAvailableModels(data.data || []);
        }
      } catch (error) {
        console.error("Failed to fetch OpenRouter models:", error);
      } finally {
        setIsLoadingModels(false);
      }
    };

    fetchModels();
  }, [openRouterKey]);

  const handleSave = (modelType: 'llm' | 'image_generator' | 'tts' | 'world_simulator', model: string) => {
    if (model) {
      setSavingModel(modelType);
      updateModel.mutate(
        { modelType, model },
        {
          onSettled: () => setSavingModel(null),
        }
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* LLM Model Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Text Generation (LLM)
          </CardTitle>
          <CardDescription>
            Select the default language model for text content generation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!openRouterKey && !ollamaKey && !alibabaKey ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You need to add an OpenRouter, Ollama, or Alibaba API key before selecting a model.
                Go to the API Keys tab to add one.
              </AlertDescription>
            </Alert>
          ) : isLoadingModels ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading models...</span>
            </div>
          ) : (
            <>
              {!selectedLlm ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-muted p-3 mb-4">
                    <Brain className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium mb-2">No Default Model Set</h3>
                  <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                    Select a default LLM model to use across all your blueprints
                  </p>
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-sm font-medium">Default LLM Model</label>
                <SearchableSelect
                  value={selectedLlm}
                  onValueChange={setSelectedLlm}
                  options={sortedLlmModels}
                  placeholder="Select an LLM model"
                  searchPlaceholder="Search by name, ID, or description..."
                  showProvider={false}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  variant="cta"
                  onClick={() => handleSave('llm', selectedLlm)}
                  disabled={!selectedLlm || savingModel === 'llm'}
                  className="font-medium shadow-lg disabled:opacity-50"
                >
                  {savingModel === 'llm' ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Image Generator Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image className="h-5 w-5" />
            Image Generation (T2I)
          </CardTitle>
          <CardDescription>
            Select the default model for generating images from text
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!openRouterKey ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You need to add an OpenRouter API key before selecting an image generator.
                Go to the API Keys tab to add one.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {isLoadingImageT2I ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  {!selectedImageGen ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="rounded-full bg-muted p-3 mb-4">
                        <Image className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <h3 className="font-medium mb-2">No Default Model Set</h3>
                      <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                        Select a default image generator to use for text-to-image generation
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Default Image Generator</label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => refetchImageT2I()}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                    <SearchableSelect
                      value={selectedImageGen}
                      onValueChange={setSelectedImageGen}
                      options={imageGenerators}
                      placeholder="Select an image generator"
                      searchPlaceholder="Search models..."
                      showProvider={true}
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      variant="cta"
                      onClick={() => handleSave('image_generator', selectedImageGen)}
                      disabled={!selectedImageGen || savingModel === 'image_generator'}
                      className="font-medium shadow-lg disabled:opacity-50"
                    >
                      {savingModel === 'image_generator' ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* World Simulator (T2V) Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Film className="h-5 w-5" />
            Text-to-Video (T2V)
          </CardTitle>
          <CardDescription>
            Select the default world simulator model for generating videos from text
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!replicateKey ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You need to add a Replicate API key before selecting a T2V model.
                Go to the API Keys tab to add one.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {isLoadingReplicateT2V ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  {!selectedWorldSim ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="rounded-full bg-muted p-3 mb-4">
                        <Film className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <h3 className="font-medium mb-2">No Default Model Set</h3>
                      <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                        Select a default world simulator to generate videos from text
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Default T2V Model</label>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => refetchReplicateT2V()}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                    <SearchableSelect
                      value={selectedWorldSim}
                      onValueChange={setSelectedWorldSim}
                      options={t2vModels}
                      placeholder="Select a T2V model"
                      searchPlaceholder="Search models..."
                      showProvider={true}
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      variant="cta"
                      onClick={() => handleSave('world_simulator', selectedWorldSim)}
                      disabled={!selectedWorldSim || savingModel === 'world_simulator'}
                      className="font-medium shadow-lg disabled:opacity-50"
                    >
                      {savingModel === 'world_simulator' ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ElevenLabs TTS Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Text-to-Speech (ElevenLabs)
          </CardTitle>
          <CardDescription>
            Select the default ElevenLabs model for voice generation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!elevenLabsKey ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You need to add an ElevenLabs API key before selecting a TTS model.
                Go to the API Keys tab to add one.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {isLoadingELModels ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  {!selectedTts ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="rounded-full bg-muted p-3 mb-4">
                        <Mic className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <h3 className="font-medium mb-2">No Default Model Set</h3>
                      <p className="text-sm text-muted-foreground mb-4 max-w-sm">
                        Select a default ElevenLabs model for text-to-speech generation
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Default TTS Model</label>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => refetchELModels()}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                    <SearchableSelect
                      value={selectedTts}
                      onValueChange={setSelectedTts}
                      options={elevenLabsModelsList}
                      placeholder="Select a TTS model"
                      searchPlaceholder="Search models..."
                      showProvider={false}
                    />
                  </div>

                  <div className="flex justify-end">
                    <Button
                      variant="cta"
                      onClick={() => handleSave('tts', selectedTts)}
                      disabled={!selectedTts || savingModel === 'tts'}
                      className="font-medium shadow-lg disabled:opacity-50"
                    >
                      {savingModel === 'tts' ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
