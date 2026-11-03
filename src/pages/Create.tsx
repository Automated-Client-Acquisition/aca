import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { WizardLayout } from "@/components/assembler/wizard/WizardLayout";
import { BlueprintStep } from "@/components/assembler/wizard/steps/BlueprintStep";
import { ConfigurationStep } from "@/components/assembler/wizard/steps/ConfigurationStep";
import { IdeasWithLibraryStep } from "@/components/assembler/wizard/steps/IdeasWithLibraryStep";
import { LibraryStep } from "@/components/assembler/wizard/steps/LibraryStep";
import { ReviewStep } from "@/components/assembler/wizard/steps/ReviewStep";
import { useWizardState } from "@/hooks/useWizardState";
import { useBlueprints } from "@/hooks/useBlueprints";
import { useIdeas } from "@/hooks/useIdeas";
import { useState, useEffect, useRef } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { getStarterBlueprintById } from "@/data/starterPackBlueprints";
import { requiresConfiguration } from "@/lib/pipelineUtils";
import { useRecorderOverlay } from "@/contexts/RecorderContext";
import type { Blueprint } from "@/types/blueprint";
import { DEFAULT_VIDEO_CONFIG } from "@/types/video";
import { useBrandKit } from "@/hooks/useBrandKit";
import { getRequiredLibraryTables } from "@/lib/blueprintUtils";
import { KIND_TABLE, LIBRARY_KINDS, TABLE_KIND, parseBlueprintContext } from "@/lib/blueprint-context";
import type { PinnedLibraryElements } from "@/types/blueprint";
import { CreatePicker } from "@/components/blueprints/CreatePicker";
import { runPath, supportsRunComposer } from "@/lib/blueprint-routes";

/**
 * /create routes to the right place:
 *  - no blueprint yet → pick one (then the one-screen Run)
 *  - a blueprint the Run screen handles → Run
 *  - recordings, video sources, starter packs, ?wizard=1 → the classic wizard
 */
export default function Create() {
  const [searchParams] = useSearchParams();
  const { data: blueprints, isLoading } = useBlueprints();
  const classic = searchParams.get("wizard") === "1" || !!searchParams.get("source") || !!searchParams.get("fromOverlay");
  const blueprintId = searchParams.get("blueprint");
  const ideaIds = (searchParams.get("ideas") ?? "").split(",").filter(Boolean);

  if (classic) return <CreateWizard />;
  if (blueprintId) {
    if (isLoading) return <AppLayout><div className="flex-1" /></AppLayout>;
    const bp = blueprints?.find((b) => b.id === blueprintId);
    if (bp && supportsRunComposer(bp)) return <Navigate to={runPath(bp, ideaIds)} replace />;
    return <CreateWizard />;
  }
  return <CreatePicker ideaIds={ideaIds} />;
}

function CreateWizard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: blueprints } = useBlueprints();
  const { ideas } = useIdeas();
  const wizardState = useWizardState();
  const { consumeRecording } = useRecorderOverlay();
  const currentStep = wizardState.steps[wizardState.currentStepIndex];
  const [generateHandler, setGenerateHandler] = useState<(() => Promise<void>) | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const ideasPreselectedRef = useRef(false);
  const sourceAppliedRef = useRef(false);
  const overlayConsumedRef = useRef(false);
  const brandKit = useBrandKit();
  const defaultsPinnedForRef = useRef<string | null>(null);

  // Pre-select the workspace defaults (Brand Kit) for every library the
  // blueprint needs, so the Library step arrives filled in. The user can still
  // change them there; libraries the blueprint turns off are left alone.
  useEffect(() => {
    const bp = wizardState.blueprint;
    if (!bp || brandKit.isLoading || defaultsPinnedForRef.current === bp.id) return;
    defaultsPinnedForRef.current = bp.id;

    const context = parseBlueprintContext(bp.context);
    const tables = new Set<string>(getRequiredLibraryTables(bp));
    for (const kind of LIBRARY_KINDS) {
      const mode = context?.[kind]?.mode;
      if (mode === "always" || mode === "relevant") tables.add(KIND_TABLE[kind]);
    }

    const next: PinnedLibraryElements = { ...wizardState.pinnedLibraryElements };
    let changed = false;
    for (const table of tables) {
      const kind = TABLE_KIND[table];
      if (!kind || context?.[kind]?.mode === "off") continue;
      if (Object.keys(next[table]?.elements ?? {}).length > 0) continue;
      const resolved = brandKit.resolve(kind, context?.[kind]?.element_id);
      if (!resolved) continue;
      // Reference-image libraries mean "use its images", like picking it by hand does.
      const el = resolved.element as Record<string, any>;
      const images = (bp.reference_image_libraries ?? []).includes(table as any)
        ? (el.reference_images || el.images || el.logos || (el.logo ? [el.logo] : [])) as string[]
        : undefined;
      next[table] = { combination_mode: "combine", elements: { [resolved.element.id]: images?.length ? { selected_images: [...images] } : {} } };
      changed = true;
    }
    if (changed) wizardState.setPinnedLibraryElements(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardState.blueprint, brandKit.isLoading]);

  // Preselect blueprint from URL parameter (user blueprints or starter pack)
  useEffect(() => {
    // Check for user blueprint first
    const blueprintId = searchParams.get('blueprint');
    if (blueprintId && blueprints && !wizardState.blueprint) {
      const selectedBlueprint = blueprints.find(b => b.id === blueprintId);
      if (selectedBlueprint) {
        wizardState.setBlueprint(selectedBlueprint);
        // Auto-advance to next step if we're on the first step
        // Step 1 is configuration step (if pipeline requires it) or ideas step
        if (wizardState.currentStepIndex === 0) {
          wizardState.goToStep(1);
        }
      }
    }

    // Check for starter pack blueprint
    const starterPackId = searchParams.get('starterPack');
    if (starterPackId && !wizardState.blueprint) {
      const starterBlueprint = getStarterBlueprintById(starterPackId);
      if (starterBlueprint) {
        // Convert starter pack blueprint to Blueprint type
        const blueprint: Blueprint = {
          id: starterBlueprint.id,
          organization_id: 'starter-pack',
          name: starterBlueprint.name,
          description: starterBlueprint.description,
          master_prompt: starterBlueprint.master_prompt,
          image_prompt: starterBlueprint.image_prompt,
          structure: starterBlueprint.structure,
          model_config: starterBlueprint.model_config,
          pipeline: starterBlueprint.pipeline,
          tags: starterBlueprint.tags,
          is_public: true,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        wizardState.setBlueprint(blueprint);
        // Auto-advance to next step if we're on the first step
        // Step 1 is configuration step (if pipeline requires it) or ideas step
        if (wizardState.currentStepIndex === 0) {
          wizardState.goToStep(1);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, blueprints, wizardState.blueprint, wizardState.currentStepIndex]);

  // Preselect ideas from URL parameter
  useEffect(() => {
    const ideaIds = searchParams.get('ideas');
    if (ideaIds && ideas.length > 0 && !ideasPreselectedRef.current) {
      const ids = ideaIds.split(',');
      const selectedIdeas = ideas.filter(idea => ids.includes(idea.id));
      if (selectedIdeas.length > 0) {
        const ideaRows = selectedIdeas.map(idea => ({
          id: idea.id,
          context: idea.title,
        }));
        wizardState.setIdeaRows(ideaRows);
        ideasPreselectedRef.current = true;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, ideas]);

  // Enable recording mode from URL parameter (e.g. ?source=record from RecordButton)
  useEffect(() => {
    const source = searchParams.get('source');
    if (source === 'record' && !wizardState.isRecordingMode) {
      wizardState.setIsRecordingMode(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Pre-set video source when blueprint is selected in recording mode
  useEffect(() => {
    if (!wizardState.isRecordingMode || sourceAppliedRef.current) return;
    if (!wizardState.blueprint || wizardState.blueprint.pipeline !== 'video') return;

    sourceAppliedRef.current = true;

    // Derive orientation from recording metadata if available
    const recOrientation = wizardState.preRecordedEditorState
      ? (wizardState.preRecordedEditorState.screenHeight > wizardState.preRecordedEditorState.screenWidth ? 'portrait' : 'landscape')
      : undefined;

    wizardState.setUnifiedVideoConfig({
      ...DEFAULT_VIDEO_CONFIG,
      ...(wizardState.blueprint.model_config?.video_config_defaults || {}),
      source: 'record',
      ...(recOrientation ? { orientation: recOrientation as any } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardState.isRecordingMode, wizardState.blueprint]);

  // Consume pre-recorded EditorState from recorder overlay
  useEffect(() => {
    if (overlayConsumedRef.current) return;
    if (searchParams.get('fromOverlay') !== 'true') return;
    if (!blueprints || blueprints.length === 0) return;

    const recording = consumeRecording();
    if (!recording) return;

    overlayConsumedRef.current = true;

    // Always store the recording and enable recording mode
    wizardState.setIsRecordingMode(true);
    wizardState.setPreRecordedEditorState(recording);

    // Derive orientation from the recording dimensions
    const recordingOrientation = recording.screenHeight > recording.screenWidth ? 'portrait' : 'landscape';

    // Auto-select first video blueprint if available
    const videoBlueprint = blueprints.find(b => b.pipeline === 'video');
    if (videoBlueprint) {
      wizardState.setBlueprint(videoBlueprint);
      wizardState.setUnifiedVideoConfig({
        ...DEFAULT_VIDEO_CONFIG,
        ...(videoBlueprint.model_config?.video_config_defaults || {}),
        source: 'record',
        orientation: recordingOrientation as any,
      });
    }

    // Clean up the fromOverlay param
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('fromOverlay');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, blueprints]);

  // Auto-advance to review step when pre-recorded EditorState is set
  useEffect(() => {
    if (!wizardState.preRecordedEditorState) return;
    if (!wizardState.blueprint) return;
    // Jump to the last step (review)
    const reviewIndex = wizardState.steps.findIndex(s => s.type === 'review');
    if (reviewIndex >= 0 && wizardState.currentStepIndex !== reviewIndex) {
      wizardState.goToStep(reviewIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardState.preRecordedEditorState, wizardState.blueprint, wizardState.steps]);

  const handleGenerate = async () => {
    if (generateHandler) {
      setIsGenerating(true);
      try {
        await generateHandler();
      } catch (error) {
        // Error handling is done in the handler itself
        console.error('Generation error:', error);
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const renderStepContent = () => {
    if (!currentStep) return null;

    switch (currentStep.type) {
      case 'blueprint':
        return (
          <BlueprintStep
            selectedBlueprint={wizardState.blueprint}
            onSelect={wizardState.setBlueprint}
            pipelineFilter={wizardState.isRecordingMode ? 'video' : undefined}
            recordingMode={wizardState.isRecordingMode}
            hasPreRecordedVideo={!!wizardState.preRecordedEditorState}
          />
        );

      case 'configuration':
        if (!wizardState.blueprint) {
          return <div className="text-center text-muted-foreground py-12">Please select a blueprint first</div>;
        }
        return (
          <ConfigurationStep
            blueprint={wizardState.blueprint}
            videoConfig={wizardState.videoConfig}
            onVideoConfigChange={wizardState.setVideoConfig}
            outputConfig={wizardState.outputConfig}
            onOutputConfigChange={wizardState.setOutputConfig}
            presenterConfig={wizardState.presenterConfig}
            onPresenterConfigChange={wizardState.setPresenterConfig}
            remixConfig={wizardState.remixConfig}
            onRemixConfigChange={wizardState.setRemixConfig}
            unifiedVideoConfig={wizardState.unifiedVideoConfig}
            onUnifiedVideoConfigChange={wizardState.setUnifiedVideoConfig}
            recordingMode={wizardState.isRecordingMode}
          />
        );

      case 'ideas':
        if (!wizardState.blueprint) {
          return <div className="text-center text-muted-foreground py-12">Please select a blueprint first</div>;
        }
        return (
          <IdeasWithLibraryStep
            blueprint={wizardState.blueprint}
            ideaRows={wizardState.ideaRows}
            onIdeaRowsChange={wizardState.setIdeaRows}
            ideaAiInsights={wizardState.ideaAiInsights}
            onIdeaAiInsightsChange={wizardState.updateIdeaAiInsights}
            videoSource={wizardState.unifiedVideoConfig?.source}
          />
        );

      case 'library':
        if (!wizardState.blueprint) {
          return <div className="text-center text-muted-foreground py-12">Please select a blueprint first</div>;
        }
        return (
          <LibraryStep
            blueprint={wizardState.blueprint}
            pinnedLibraryElements={wizardState.pinnedLibraryElements}
            onLibraryElementsChange={wizardState.setPinnedLibraryElements}
          />
        );

      case 'review':
        if (!wizardState.blueprint || (wizardState.ideaRows.length === 0 && !wizardState.preRecordedEditorState)) {
          return <div className="text-center text-muted-foreground py-12">Please complete previous steps first</div>;
        }
        return (
          <ReviewStep
            blueprint={wizardState.blueprint}
            ideaRows={wizardState.ideaRows}
            pinnedLibraryElements={wizardState.pinnedLibraryElements}
            customPrompt={wizardState.customPrompt}
            customImagePrompt={wizardState.customImagePrompt}
            customDirectorPrompt={wizardState.customDirectorPrompt}
            videoConfig={wizardState.videoConfig}
            outputConfig={wizardState.outputConfig}
            presenterConfig={wizardState.presenterConfig}
            remixConfig={wizardState.remixConfig}
            unifiedVideoConfig={wizardState.unifiedVideoConfig}
            preRecordedEditorState={wizardState.preRecordedEditorState}
            hasConfirmedReview={wizardState.hasConfirmedReview}
            ideaAiInsights={wizardState.ideaAiInsights}
            autoApproveAll={wizardState.autoApproveAll}
            onCustomPromptChange={wizardState.setCustomPrompt}
            onCustomImagePromptChange={wizardState.setCustomImagePrompt}
            onCustomDirectorPromptChange={wizardState.setCustomDirectorPrompt}
            onHasConfirmedReviewChange={wizardState.setHasConfirmedReview}
            onAutoApproveAllChange={wizardState.setAutoApproveAll}
            onReset={wizardState.reset}
            onGenerate={(handler) => setGenerateHandler(() => handler)}
          />
        );

      default:
        return null;
    }
  };

  return (
    <AppLayout
      header={
        <div className="ml-auto flex items-center gap-2">
          <UserProfileMenu />
        </div>
      }
      disableScroll={true}
    >
      <WizardLayout
        {...wizardState}
        onLastStepAction={handleGenerate}
        isLastStepPending={isGenerating}
      >
        {renderStepContent()}
      </WizardLayout>
    </AppLayout>
  );
}
