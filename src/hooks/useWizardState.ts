import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Blueprint, PinnedLibraryElements } from "@/types/blueprint";
import { ManualIdeaRow } from "@/types/generation";
import { WizardState, WizardActions, WizardStep, VideoConfig, OutputConfig, IdeaAiInsightsMap, SelectedAiInsights } from "@/types/wizard";
import type { RecordingMetadata } from "@/contexts/RecorderContext";
import type { VideoConfig as UnifiedVideoConfig } from "@/types/video";
import { DEFAULT_VIDEO_CONFIG } from "@/types/video";
import type { PresenterVideoConfigValues } from "@/components/presenter/PresenterVideoConfig";
import type { VideoRemixConfigValues } from "@/components/remix/VideoRemixConfig";
import { parseAllPromptSlots } from "@/lib/blueprintUtils";
import { requiresConfiguration, getPipelineLibraryNeeds } from "@/lib/pipelineUtils";
import { nanoid } from "nanoid";

const LIBRARY_TABLE_LABELS: Record<string, string> = {
  library_brand_voices: "Brand Voices",
  library_characters: "Characters",
  library_blocks: "Blocks",
  library_products: "Products",
  library_icps: "Target Audiences",
};

export function useWizardState(): WizardState & WizardActions {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [ideaRows, setIdeaRows] = useState<ManualIdeaRow[]>([]);
  const [pinnedLibraryElements, setPinnedLibraryElements] = useState<PinnedLibraryElements>({});
  const [customPrompt, setCustomPrompt] = useState<string | null>(null);
  const [customImagePrompt, setCustomImagePrompt] = useState<string | null>(null);
  const [customDirectorPrompt, setCustomDirectorPrompt] = useState<string | null>(null);
  const [hasConfirmedReview, setHasConfirmedReview] = useState(false);
  const [videoConfig, setVideoConfig] = useState<VideoConfig | null>(() => {
    // Default video config for video pipelines
    return {
      totalDuration: 60,
      aspectRatio: 'landscape',
    };
  });
  const [outputConfig, setOutputConfig] = useState<OutputConfig | null>(() => {
    // Default output config for visual pipelines
    return {
      aspectRatio: 'landscape',
    };
  });

  // Presenter video config (for presenter_video pipeline)
  const [presenterConfig, setPresenterConfig] = useState<PresenterVideoConfigValues | null>(null);

  // Video remix config (for video_remix pipeline)
  const [remixConfig, setRemixConfig] = useState<VideoRemixConfigValues | null>(null);

  // Unified video config (for 'video' pipeline)
  const [unifiedVideoConfig, setUnifiedVideoConfig] = useState<UnifiedVideoConfig | null>(null);

  // Track which blueprint was used to initialize unified video config (prevent re-init on user edits)
  const initializedBlueprintRef = useRef<string | null>(null);

  // Auto-initialize unified video config from blueprint defaults when blueprint is selected
  useEffect(() => {
    if (!blueprint || blueprint.pipeline !== 'video') return;
    if (initializedBlueprintRef.current === blueprint.id) return;

    initializedBlueprintRef.current = blueprint.id;
    const bpDefaults = blueprint.model_config?.video_config_defaults || {};
    const legacySource = blueprint.model_config?.presenter_default_source_type;
    setUnifiedVideoConfig({
      ...DEFAULT_VIDEO_CONFIG,
      ...(legacySource ? { source: legacySource as any } : {}),
      ...bpDefaults,
    });
  }, [blueprint]);

  // AI insights selected per idea (for ideas with ai_analysis)
  const [ideaAiInsights, setIdeaAiInsights] = useState<IdeaAiInsightsMap>({});

  // Recording mode: streamlined wizard for screen recording flow
  const [isRecordingMode, setIsRecordingMode] = useState(false);

  // Recording metadata from the recorder overlay (video URLs + dimensions)
  const [preRecordedEditorState, setPreRecordedEditorState] = useState<RecordingMetadata | null>(null);

  // Auto-approve all pipeline stages without manual review
  const [autoApproveAll, setAutoApproveAll] = useState(false);

  // Update AI insights for a single idea
  const updateIdeaAiInsights = useCallback((ideaId: string, insights: SelectedAiInsights | null) => {
    setIdeaAiInsights(prev => ({ ...prev, [ideaId]: insights }));
  }, []);

  // Check if all required library elements are selected.
  // Considers both library elements defined in prompts (master_prompt, image_prompt,
  // director_prompt) and libraries the blueprint opted into via reference_image_libraries —
  // the latter has no prompt slot, so it was previously invisible to this check and let
  // users continue with zero images pinned even though the blueprint asked for a library.
  const areRequiredLibraryElementsSelected = useCallback((): boolean => {
    if (!blueprint) return true;

    const parsedSlots = parseAllPromptSlots(blueprint.master_prompt || '', blueprint.image_prompt, blueprint.director_prompt);
    const librarySlots = parsedSlots.filter(
      slot => slot.type === 'library_element' && slot.library_table
    );
    const referenceImageLibraries = blueprint.reference_image_libraries || [];

    const uniqueLibraryTables = Array.from(
      new Set([
        ...librarySlots.map(slot => slot.library_table!).filter(Boolean),
        ...referenceImageLibraries,
      ])
    );

    return uniqueLibraryTables.every(libraryTable => {
      const slot = librarySlots.find(s => s.library_table === libraryTable);
      // From a prompt slot: required unless explicitly marked optional.
      // From reference_image_libraries only (no slot): the blueprint opted in, so required.
      const isRequired = slot ? slot.required !== false : true;

      if (!isRequired) return true; // Optional libraries don't block

      const selection = pinnedLibraryElements[libraryTable];
      return !!(selection?.elements && Object.keys(selection.elements).length > 0);
    });
  }, [blueprint, pinnedLibraryElements]);

  // Pipeline-level library needs (e.g., TTS pipelines benefit from character for voice)
  const pipelineLibraryNeeds = useMemo(() => {
    if (!blueprint?.pipeline) return [];
    return getPipelineLibraryNeeds(blueprint.pipeline);
  }, [blueprint?.pipeline]);

  // Check if blueprint requires any library elements (from prompts, reference_image_libraries, or pipeline needs)
  const hasLibraryRequirements = useMemo((): boolean => {
    if (!blueprint) return false;

    const parsedSlots = parseAllPromptSlots(blueprint.master_prompt || '', blueprint.image_prompt, blueprint.director_prompt);
    const librarySlots = parsedSlots.filter(
      slot => slot.type === 'library_element' && slot.library_table
    );

    // Also consider reference_image_libraries
    const referenceImageLibraries = blueprint.reference_image_libraries || [];

    // In recording mode, skip soft pipeline library needs (e.g., character for voice)
    // since the recording provides its own voice
    if (isRecordingMode) {
      return librarySlots.length > 0 || referenceImageLibraries.length > 0;
    }

    return librarySlots.length > 0 || referenceImageLibraries.length > 0 || pipelineLibraryNeeds.length > 0;
  }, [blueprint, pipelineLibraryNeeds, isRecordingMode]);

  // In recording mode, ideas are never needed — the recording is the content
  const recordingNeedsIdeas = !isRecordingMode;

  // Auto-create synthetic idea row when Ideas step is skipped in recording mode
  useEffect(() => {
    if (isRecordingMode && !recordingNeedsIdeas && ideaRows.length === 0 && blueprint) {
      setIdeaRows([{ id: nanoid(), context: `Recording: ${blueprint.name}` }]);
    }
  }, [isRecordingMode, recordingNeedsIdeas, ideaRows.length, blueprint]);

  // Check if blueprint requires configuration (video or visual pipelines)
  // For unified video: skip config if blueprint already defines source default
  // When a pre-recorded EditorState exists (from overlay), skip config entirely
  const hasConfigurationRequirements = useMemo((): boolean => {
    if (!blueprint) return false;
    // Recording already completed — no need for configuration
    if (preRecordedEditorState) return false;
    if (blueprint.pipeline === 'video') {
      const vcd = blueprint.model_config?.video_config_defaults;
      // In recording mode, always show config so the recorder UI is accessible
      if (vcd?.source && !isRecordingMode) return false;
    }
    return requiresConfiguration(blueprint.pipeline);
  }, [blueprint, isRecordingMode, preRecordedEditorState]);

  // Dynamically generate steps based on blueprint requirements
  const steps = useMemo((): WizardStep[] => {
    const baseSteps: WizardStep[] = [
      {
        id: 'blueprint',
        type: 'blueprint',
        title: 'Select Blueprint',
        description: 'Choose a content blueprint to use',
        isComplete: !!blueprint,
        isRequired: true,
      },
    ];

    // Add configuration step only if blueprint requires it (video or visual pipelines)
    if (hasConfigurationRequirements) {
      baseSteps.push({
        id: 'configuration',
        type: 'configuration',
        title: isRecordingMode ? 'Record' : 'Configure Output',
        description: isRecordingMode ? 'Record your screen and configure settings' : 'Set format and dimensions',
        // Configuration step is always complete (has default values)
        isComplete: true,
        isRequired: true,
      });
    }

    // Add ideas step (renamed for video pipelines based on source type)
    // In recording mode, skip ideas if the blueprint doesn't reference idea/AI variables
    const isVideoRemix = blueprint?.pipeline === 'video_remix';
    const isPresenterVideo = blueprint?.pipeline === 'presenter_video';
    const isUnifiedVideo = blueprint?.pipeline === 'video';
    const videoSource = unifiedVideoConfig?.source;

    const needsIdeas = isRecordingMode ? false : true;

    if (needsIdeas) {
      // Compute ideas step title and description based on pipeline + source
      let ideasTitle = 'Content Ideas';
      let ideasDescription = 'Select ideas and configure AI breakdown';
      if (isVideoRemix) {
        ideasTitle = 'Source Videos';
        ideasDescription = 'Upload videos to remix';
      } else if (isPresenterVideo) {
        ideasTitle = 'Source Pages';
        ideasDescription = 'Add web pages or videos to present';
      } else if (isUnifiedVideo) {
        if (videoSource === 'url') { ideasTitle = 'Source Pages'; ideasDescription = 'Add URLs to capture'; }
        else if (videoSource === 'upload_video') { ideasTitle = 'Source Videos'; ideasDescription = 'Upload videos to process'; }
        else if (videoSource === 'upload_images') { ideasTitle = 'Source Images'; ideasDescription = 'Upload images for the video'; }
        else { ideasTitle = 'Content Ideas'; ideasDescription = 'Describe what each video should be about'; }
      }

      baseSteps.push({
        id: 'ideas',
        type: 'ideas',
        title: ideasTitle,
        description: ideasDescription,
        isComplete: ideaRows.length > 0 && (
          isVideoRemix
            ? ideaRows.every(row => !!row.uploadedVideoUrl?.trim())
            : isPresenterVideo
            ? ideaRows.every(row => {
                const st = row.sourceType || 'url';
                if (st === 'url') return !!row.sourceUrl?.trim();
                if (st === 'upload') return !!row.uploadedVideoUrl?.trim();
                if (st === 'prompt_only') return row.context.trim().length >= 20;
                return false;
              })
            : isUnifiedVideo
            ? ideaRows.every(row => {
                if (videoSource === 'url') return !!row.sourceUrl?.trim();
                if (videoSource === 'upload_video') return !!row.uploadedVideoUrl?.trim();
                // upload_images and prompt_only need text context
                return row.context.trim().length > 0;
              })
            : ideaRows.every(row => row.context.trim().length > 0)
        ),
        isRequired: true,
      });
    }

    // Add library step only if blueprint requires library elements
    if (hasLibraryRequirements) {
      baseSteps.push({
        id: 'library',
        type: 'library',
        title: 'Library Elements',
        description: 'Select library elements to use',
        isComplete: areRequiredLibraryElementsSelected(),
        isRequired: true,
      });
    }

    // Add review step
    baseSteps.push({
      id: 'review',
      type: 'review',
      title: 'Review & Generate',
      description: 'Review your selections and start generation',
      isComplete: false,
      isRequired: true,
    });

    return baseSteps;
  }, [blueprint, ideaRows, hasLibraryRequirements, hasConfigurationRequirements, areRequiredLibraryElementsSelected, unifiedVideoConfig, isRecordingMode]);

  const canProceed = useCallback((): boolean => {
    const currentStep = steps[currentStepIndex];
    if (!currentStep) return false;

    switch (currentStep.type) {
      case 'blueprint':
        return !!blueprint;
      case 'configuration':
        // For presenter_video, source validation moved to Ideas step
        if (blueprint?.pipeline === 'presenter_video') {
          return true;
        }
        return true;
      case 'ideas':
        // For video_remix: each idea needs an uploaded video URL
        if (blueprint?.pipeline === 'video_remix') {
          return ideaRows.length > 0 &&
            ideaRows.every(row => !!row.uploadedVideoUrl?.trim());
        }
        // For presenter_video: validate based on per-row source type
        if (blueprint?.pipeline === 'presenter_video') {
          return ideaRows.length > 0 && ideaRows.every(row => {
            const st = row.sourceType || 'url';
            if (st === 'url') return !!row.sourceUrl?.trim();
            if (st === 'upload') return !!row.uploadedVideoUrl?.trim();
            if (st === 'prompt_only') return row.context.trim().length >= 20;
            return false;
          });
        }
        // For unified video: validate based on video config source
        if (blueprint?.pipeline === 'video' && unifiedVideoConfig) {
          const src = unifiedVideoConfig.source;
          return ideaRows.length > 0 && ideaRows.every(row => {
            if (src === 'url') return !!row.sourceUrl?.trim();
            if (src === 'upload_video') return !!row.uploadedVideoUrl?.trim();
            return row.context.trim().length > 0;
          });
        }
        // For other pipelines: each idea needs text content
        return ideaRows.length > 0 &&
          ideaRows.every(row => row.context.trim().length > 0);
      case 'library':
        // Must have all required library elements selected
        return areRequiredLibraryElementsSelected();
      case 'review':
        return hasConfirmedReview;
      default:
        return false;
    }
  }, [currentStepIndex, steps, blueprint, ideaRows, areRequiredLibraryElementsSelected, hasConfirmedReview, presenterConfig, remixConfig, unifiedVideoConfig]);

  const goToStep = useCallback((index: number) => {
    if (index >= 0 && index < steps.length) {
      setCurrentStepIndex(index);
    }
  }, [steps.length]);

  const nextStep = useCallback(() => {
    if (currentStepIndex < steps.length - 1 && canProceed()) {
      setCurrentStepIndex(prev => prev + 1);
    }
  }, [currentStepIndex, steps.length, canProceed]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex]);

  const reset = useCallback(() => {
    setCurrentStepIndex(0);
    setBlueprint(null);
    setIdeaRows([]);
    setPinnedLibraryElements({});
    setCustomPrompt(null);
    setCustomImagePrompt(null);
    setCustomDirectorPrompt(null);
    setHasConfirmedReview(false);
    setVideoConfig(null);
    setOutputConfig(null);
    setPresenterConfig(null);
    setRemixConfig(null);
    setUnifiedVideoConfig(null);
    initializedBlueprintRef.current = null;
    setIdeaAiInsights({});
    setAutoApproveAll(false);
    setIsRecordingMode(false);
    setPreRecordedEditorState(null);
  }, []);

  return {
    currentStepIndex,
    steps,
    blueprint,
    ideaRows,
    pinnedLibraryElements,
    customPrompt,
    customImagePrompt,
    customDirectorPrompt,
    hasConfirmedReview,
    videoConfig,
    outputConfig,
    presenterConfig,
    remixConfig,
    unifiedVideoConfig,
    ideaAiInsights,
    autoApproveAll,
    isRecordingMode,
    preRecordedEditorState,
    goToStep,
    nextStep,
    prevStep,
    setBlueprint,
    setIdeaRows,
    setPinnedLibraryElements,
    setCustomPrompt,
    setCustomImagePrompt,
    setCustomDirectorPrompt,
    setHasConfirmedReview,
    setVideoConfig,
    setOutputConfig,
    setPresenterConfig,
    setRemixConfig,
    setUnifiedVideoConfig,
    setIdeaAiInsights,
    updateIdeaAiInsights,
    setAutoApproveAll,
    setIsRecordingMode,
    setPreRecordedEditorState,
    canProceed,
    reset,
  };
}
