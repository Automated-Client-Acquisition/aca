import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Copy, Trash2, RotateCcw, Wand2, Send, Bookmark, Loader2, RefreshCw, Pencil, FileText, Sparkles, LayoutGrid, Image, Mic, AudioLines, Video, Film, Layers, Settings, ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StageConfig } from "@/types/pipelineStages";
import { CompactStageProgress } from "./CompactStageProgress";
import { StageTab } from "./StageTab";
import { TextContentSection } from "./viewers/TextContentSection";
import { ImageContentSection } from "./viewers/ImageContentSection";
import { AudioContentSection } from "./viewers/AudioContentSection";
import { VideoContentSection } from "./viewers/VideoContentSection";
import { ScenePromptsViewer } from "./viewers/ScenePromptsViewer";
import { EnhancedSceneViewer } from "./viewers/EnhancedSceneViewer";
import { StageContentViewer } from "./viewers/StageContentViewer";
import { CarouselSlideGrid, type SlideContentEdits } from "./viewers/CarouselSlideGrid";
import { CarouselStyleEditor } from "./viewers/CarouselStyleEditor";
import { SubtitleEditor } from "./viewers/SubtitleEditor";
import { LoadingState } from "./viewers/LoadingState";
import { WaitingState } from "./viewers/WaitingState";
import { EmptyState } from "./viewers/EmptyState";
import { useGenerateImage } from "@/hooks/useGenerateImage";
import { useUpdateContentOutput } from "@/hooks/useUpdateContentOutput";
import { useUpdateOutputTitle } from "@/hooks/useUpdateOutputTitle";
import { useRegenerateContent } from "@/hooks/useRegenerateContent";
import { useStageApproval } from "@/hooks/useStageApproval";
import { useSceneApproval } from "@/hooks/useSceneApproval";
import { useRegenerateScene, useRegenerateClip } from "@/hooks/useRegenerateScene";
import { useRetryAssembly } from "@/hooks/useRetryAssembly";
import { useTriggerAssembly } from "@/hooks/useTriggerAssembly";
import { StageMetadata } from "./viewers/StageMetadata";
import { PromptSection } from "./viewers/PromptSection";
import { PublishedPlatformsBadge } from "./PublishedPlatformsBadge";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { applySlideEdit, type SlideFields } from "@/lib/carousel-slide-edit";
import { toast } from "sonner";
import { PushToGHLDialog } from "./PushToGHLDialog";
import { SaveContentMultiDialog } from "@/components/saved-content/SaveContentMultiDialog";

import { Player } from '@remotion/player';
import { ShotPreviewComposition } from '@/remotion/presenter/ShotPreviewComposition';
import { DEFAULT_BRAND } from '@/remotion/presenter/types';
import type { Shot, ScreenshotData } from '@/remotion/presenter/types';
import type { EditorState, BrandConfig } from '@/lib/editorState';
import { createDefaultEditorState, compositionInputToEditorState } from '@/lib/editorState';

const VideoStudio = lazy(() =>
  import('@/components/video/VideoStudio').then(m => ({ default: m.VideoStudio }))
);
const EditorStudio = lazy(() =>
  import('@/components/video/EditorStudio').then(m => ({ default: m.EditorStudio }))
);
const EditorCompositionPreview = lazy(() =>
  import('@/remotion/compositions/EditorComposition').then(m => ({ default: m.EditorComposition }))
);

// Shot editing dropdown options for video_remix / presenter_video
const LAYOUT_OPTIONS = [
  { value: 'screenshot_fullscreen', label: 'Full Frame' },
  { value: 'text_card', label: 'Text Card' },
  { value: 'stat_card', label: 'Stat Card' },
  { value: 'quote_card', label: 'Quote Card' },
  { value: 'list_reveal', label: 'List Reveal' },
  { value: 'gradient_title', label: 'Gradient Title' },
];

const CAMERA_MOVES = [
  { value: 'ken_burns_slow', label: 'Ken Burns' },
  { value: 'punch_zoom', label: 'Punch Zoom' },
  { value: 'pan_left', label: 'Pan Left' },
  { value: 'pan_right', label: 'Pan Right' },
  { value: 'pan_down', label: 'Pan Down' },
  { value: 'zoom_out_reveal', label: 'Zoom Out' },
  { value: 'shake', label: 'Shake' },
  { value: 'hold', label: 'Hold' },
];

const TRANSITIONS = [
  { value: 'cut_hard', label: 'Hard Cut' },
  { value: 'slide_left', label: 'Slide Left' },
  { value: 'snap_cut', label: 'Snap Cut' },
  { value: 'fade', label: 'Fade' },
  { value: 'whoosh', label: 'Whoosh' },
  { value: 'slam_zoom', label: 'Slam Zoom' },
];

const SOUND_EFFECTS = [
  { value: '_none', label: 'None' },
  { value: 'whoosh', label: 'Whoosh' },
  { value: 'pop', label: 'Pop' },
  { value: 'click', label: 'Click' },
  { value: 'ding', label: 'Ding' },
  { value: 'record_scratch', label: 'Record Scratch' },
  { value: 'boom', label: 'Boom' },
  { value: 'cash_register', label: 'Cash Register' },
  { value: 'typing', label: 'Typing' },
];

// Convert presenter video director shots to Scene[] for the SceneEditor
function directorShotsToScenes(
  shots: any[],
  screenshots: any[],
  voiceData: any,
  bRollData: any,
): any[] {
  if (!shots || shots.length === 0) return [];

  const fps = 30;
  const scenes: any[] = [];

  shots.forEach((shot: any, index: number) => {
    const durationSeconds = shot.duration_seconds || shot.duration || 4;
    const screenshotUrl = shot.screenshot_url || screenshots?.[shot.screenshot_index]?.url || shot.image_url;

    // Map director layout types to SceneLayout
    const layoutMap: Record<string, string> = {
      'screenshot_fullscreen': 'screenshot_fullscreen',
      'avatar_pip': 'avatar_pip',
      'avatar_fullscreen': 'avatar_fullscreen',
      'split_screen': 'split_screen',
      'text_card': 'text_card',
      'stat_card': 'stat_card',
      'quote_card': 'quote_card',
      'list_reveal': 'list_reveal',
      'gradient_title': 'gradient_title',
      'b_roll_cutaway': 'b_roll_fullscreen',
    };

    const layout = layoutMap[shot.layout] || 'screenshot_fullscreen';

    // Build B-roll overlays from b_roll stage data
    const shotBRoll: any[] = [];
    const bRollClipsForShot = bRollData?.b_roll_by_shot?.[index]?.clips || [];
    if (bRollClipsForShot.length) {
      bRollClipsForShot.forEach((clip: any, clipIdx: number) => {
        shotBRoll.push({
          id: `broll-${index}-${clipIdx}`,
          src: clip.url,
          type: clip.type || 'video',
          from: Math.round((clip.start_seconds || 0) * fps),
          durationInFrames: Math.round((clip.duration_seconds || 3) * fps),
          label: clip.label || clip.keywords?.join(', '),
        });
      });
    }

    scenes.push({
      id: `scene-${index}`,
      type: 'video' as const,
      primarySource: screenshotUrl,
      sourceType: screenshotUrl ? 'screenshot' : undefined,
      layout,
      durationInFrames: Math.round(durationSeconds * fps),
      cameraMove: shot.camera_move || 'ken_burns_slow',
      motionBlur: shot.motion_blur || false,
      bRoll: shotBRoll,
      narration: shot.narration || shot.text || '',
      transitionToNext: shot.transition || null,
      transitionDuration: shot.transition_duration ? Math.round(shot.transition_duration * fps) : undefined,
      // For text-based layouts
      title: shot.title || shot.heading,
      subtitle: shot.subtitle,
      // For stat_card
      ...(layout === 'stat_card' && { title: shot.stat_value, subtitle: shot.stat_label }),
      // For quote_card
      ...(layout === 'quote_card' && { title: shot.quote_text, subtitle: shot.quote_attribution }),
    });
  });

  return scenes;
}

// Inline editable output title component
function EditableOutputTitle({
  outputId,
  currentTitle,
  fallbackTitle,
  jobId
}: {
  outputId: string;
  currentTitle: string | null;
  fallbackTitle: string;
  jobId?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentTitle || fallbackTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateTitleMutation = useUpdateOutputTitle();

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(currentTitle || fallbackTitle);
  }, [currentTitle, fallbackTitle]);

  const handleSave = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== currentTitle) {
      updateTitleMutation.mutate({ outputId, title: trimmedValue, jobId });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(currentTitle || fallbackTitle);
      setIsEditing(false);
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const displayTitle = currentTitle || fallbackTitle;

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="h-6 text-sm font-medium py-0 px-1.5 w-auto min-w-[200px] max-w-sm"
      />
    );
  }

  return (
    <div className="flex items-center gap-1.5 group/title min-w-0">
      <h2 className="text-sm font-medium truncate leading-tight" title={displayTitle}>
        {displayTitle}
      </h2>
      <button
        onClick={handleEditClick}
        className="opacity-0 group-hover/title:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity shrink-0"
        title="Edit title"
      >
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}

interface MultiStageDetailPanelProps {
  output: any;
  stages: StageConfig[];
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onStageApprove?: (stageId: string) => void;
  onStageReject?: (stageId: string) => void;
  onDelete: () => void;
  onCopy?: () => void;
}

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'approved': return 'bg-green-500/10 text-green-500 border-green-500/20';
    case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'processing': return 'bg-primary/10 text-primary border-primary/20';
    default: return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
  }
};

export function MultiStageDetailPanel({
  output,
  stages,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onStageApprove,
  onStageReject,
  onDelete,
  onCopy,
}: MultiStageDetailPanelProps) {
  const queryClient = useQueryClient();
  const [regeneratingSceneNumber, setRegeneratingSceneNumber] = useState<number | null>(null);
  const [regeneratingClipNumber, setRegeneratingClipNumber] = useState<number | null>(null);
  const [regeneratingCarouselSlide, setRegeneratingCarouselSlide] = useState<number | null>(null);
  const [regeneratingVoiceSegment, setRegeneratingVoiceSegment] = useState<number | null>(null);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [isSavingCarouselStyle, setIsSavingCarouselStyle] = useState(false);
  const [showVideoEditor, setShowVideoEditor] = useState(false);
  const [expandedShotIndex, setExpandedShotIndex] = useState<number | null>(null);
  const [previewingShotIndex, setPreviewingShotIndex] = useState<number | null>(null);
  const videoEditorDialogRef = useRef<HTMLDialogElement>(null);

  // Track pending operations per output ID to allow parallel operations across content pieces
  const [pendingStageApprovals, setPendingStageApprovals] = useState<Set<string>>(new Set());
  const [pendingAssembly, setPendingAssembly] = useState<Set<string>>(new Set());
  const [pendingRetryAssembly, setPendingRetryAssembly] = useState<Set<string>>(new Set());

  const triggerAssembly = useTriggerAssembly();

  // Toggle between inline editor and stage tabs for video pipelines
  const [forceTabView, setForceTabView] = useState(false);

  const data = output.data || {};
  const params = output.generation_params || {};
  // Explicit type casting to handle Json type
  const stageData = (output.stage_data as Record<string, any>) || {};

  // Extract jobId for scoped cache invalidation
  const jobId = output.job_id;

  // Video pipelines always show inline editor as primary view
  const isVideoPipeline = ['video', 'presenter_video', 'video_remix'].includes(output.pipeline);
  const compositionStageData = stageData['composition'] || stageData['final'] || stageData['video'];
  const inlineEditorState = compositionStageData?.editor_state as EditorState | undefined;
  const hasEditorState = !!(inlineEditorState && inlineEditorState.tracks?.length > 0);

  // Reconstruct EditorState from director shots + voiceover when editor_state is missing
  // This happens for completed jobs where the render worker overwrote stage_data without preserving editor_state
  const reconstructedEditorState = useMemo(() => {
    if (hasEditorState) return null;
    if (!isVideoPipeline) return null;

    const directorData = stageData['director'];
    const voiceoverData = stageData['voiceover'];
    if (!directorData?.shots?.length) return null;

    const defaultBrand: BrandConfig = {
      accent_color: '#f59e0b',
      primary_color: '#ffffff',
      background_color: '#0a0a0a',
      text_color: '#ffffff',
      font_family: 'Inter',
    };

    try {
      return compositionInputToEditorState({
        shots: directorData.shots,
        screenshots: [],
        sourceVideoUrl: null,
        sourceDurationSeconds: 0,
        audioUrl: voiceoverData?.audio_url || null,
        originalAudioUrl: null,
        wordTimestamps: voiceoverData?.word_timestamps || [],
        voiceMode: (params as any)?.voice_mode || 'generate',
        avatarVideoUrl: null,
        brand: (params as any)?.video_config?.brand || defaultBrand,
        orientation: compositionStageData?.orientation || 'landscape',
        subtitleStyle: (params as any)?.video_config?.subtitleStyle || 'clean_white',
        transitionType: (params as any)?.video_config?.transitionType,
        backgroundMusicUrl: voiceoverData?.background_music_url,
        backgroundMusicVolume: (params as any)?.video_config?.backgroundMusicVolume || 0.15,
      });
    } catch (err) {
      console.error('[MultiStageDetailPanel] Failed to reconstruct EditorState:', err);
      return null;
    }
  }, [hasEditorState, isVideoPipeline, stageData, params, compositionStageData]);

  const effectiveEditorState = inlineEditorState ?? reconstructedEditorState;
  const hasEffectiveEditorState = !!(effectiveEditorState && effectiveEditorState.tracks?.length > 0);

  const showInlineEditor = isVideoPipeline && !forceTabView;

  const title = data.title || output.content_ideas?.title || 'Untitled';

  // Extract metadata for chips (character takes priority over brand voice)
  const characterName = params.character?.name || params.library_characters?.name;
  const brandVoiceName = params.brand_voice?.name || params.brand_voice;
  const metadataLabel = characterName || brandVoiceName;

  // Extract aspect ratio from video_config for proper image/video display
  const videoConfigAspectRatio = params.video_config?.aspectRatio as 'landscape' | 'portrait' | 'square' | undefined;

  // Build stage statuses from stage_data
  // Simplified status: pending | generating | ready | failed
  const stageStatuses: Record<string, 'pending' | 'generating' | 'ready' | 'failed'> = {};
  stages.forEach(stage => {
    const data = stageData[stage.id];

    // Check if this stage is currently being generated/processed
    // The video-renderer worker sets output.status to 'processing' while rendering
    const isCurrentlyGenerating = output.current_stage === stage.id &&
      (output.status === 'generating' || output.status === 'processing');

    if (!data) {
      // No data yet - but check if it's actively being generated
      stageStatuses[stage.id] = isCurrentlyGenerating ? 'generating' : 'pending';
    } else if (data.status === 'failed') {
      stageStatuses[stage.id] = 'failed';
    } else if (data.status === 'regenerating' || data.status === 'generating' || data.render_status === 'rendering' || isCurrentlyGenerating) {
      // For gallery stages, show content if any items have data (allows viewing while generating)
      const slides = Array.isArray(data.slides) ? data.slides : [];
      const scenes = Array.isArray(data.scenes) ? data.scenes : [];
      const clips = Array.isArray(data.clips) ? data.clips : [];
      const segments = Array.isArray(data.segments) ? data.segments : [];

      const hasAnyContent =
        (slides.some((s: any) => s.image_url || s.prompt)) ||
        (scenes.some((s: any) => s.image_url || s.prompt)) ||
        (clips.some((c: any) => c.video_url)) ||
        (segments.some((s: any) => s.audio_url));

      // Check if this is a single-item regeneration
      const isSingleItemRegen =
        (slides.length > 1 && slides.filter((s: any) => s.status === 'generating').length <= 1) ||
        (scenes.length > 1 && scenes.filter((s: any) => s.status === 'generating').length <= 1) ||
        (clips.length > 1 && clips.filter((c: any) => c.status === 'generating').length <= 1) ||
        (segments.length > 1 && segments.filter((s: any) => s.status === 'generating').length <= 1);

      if (hasAnyContent || isSingleItemRegen) {
        stageStatuses[stage.id] = 'ready';  // Show gallery view with partial content
      } else {
        stageStatuses[stage.id] = 'generating';
      }
    } else if (data.content || data.scenes || data.url || data.audio_url || data.image_url || data.clips || data.style || data.slides || data.segments || data.transcript ||
               data.status === 'approved' || data.status === 'ready' || data.status === 'awaiting_approval' || data.status === 'awaiting_input') {
      // Has content or any completion status = ready
      stageStatuses[stage.id] = 'ready';
    } else {
      stageStatuses[stage.id] = 'pending';
    }
  });

  // For video_remix: the backend runs either 'voice_avatar' or 'voiceover' depending on
  // voice option, but the frontend tab only defines 'voice_avatar'. If voiceover data
  // exists, mirror its status to the voice_avatar tab.
  if (stageStatuses['voice_avatar'] === 'pending' && stageData['voiceover']) {
    const voData = stageData['voiceover'];
    if (voData.status === 'failed') {
      stageStatuses['voice_avatar'] = 'failed';
    } else if (voData.status === 'generating' || voData.status === 'regenerating') {
      stageStatuses['voice_avatar'] = 'generating';
    } else if (voData.audio_url || voData.url || voData.content || voData.status === 'approved' || voData.status === 'ready') {
      stageStatuses['voice_avatar'] = 'ready';
    }
  }
  // Also handle the case where current_stage is 'voiceover' — show voice_avatar tab as generating
  if (stageStatuses['voice_avatar'] === 'pending' && output.current_stage === 'voiceover' &&
      (output.status === 'generating' || output.status === 'processing')) {
    stageStatuses['voice_avatar'] = 'generating';
  }

  // Active tab state - initialize to first stage needing attention, or first stage
  const [activeStageTab, setActiveStageTab] = useState<string>(() => {
    const needsAttention = stages.find(s => {
      const status = stageStatuses[s.id];
      return status === 'ready' || status === 'generating';
    });
    return needsAttention?.id || stages[0]?.id || '';
  });
  const [loadingStages, setLoadingStages] = useState<Record<string, boolean>>({});

  // Auto-navigate to active stage (forward-only)
  // Priority: generating stages first, then the furthest ready stage
  useEffect(() => {
    // First, check for any generating stage (highest priority - user wants to see progress)
    const generatingStage = stages.find(s => stageStatuses[s.id] === 'generating');

    // If no generating stage, find the furthest 'ready' stage that needs attention
    // (i.e., the most recent stage that completed)
    let targetStage = generatingStage;
    if (!targetStage) {
      // Find the last ready stage (furthest in pipeline)
      for (let i = stages.length - 1; i >= 0; i--) {
        if (stageStatuses[stages[i].id] === 'ready') {
          targetStage = stages[i];
          break;
        }
      }
    }

    if (targetStage && targetStage.id !== activeStageTab) {
      const currentIndex = stages.findIndex(s => s.id === activeStageTab);
      const targetIndex = stages.findIndex(s => s.id === targetStage.id);

      // Auto-advance if:
      // 1. Target is further along in the pipeline, OR
      // 2. Target is generating (always show generating stage), OR
      // 3. Current stage is already complete (ready)
      const shouldAdvance =
        targetIndex > currentIndex ||
        stageStatuses[targetStage.id] === 'generating' ||
        stageStatuses[activeStageTab] === 'ready';

      if (shouldAdvance) {
        setActiveStageTab(targetStage.id);
      }
    }
  }, [output.current_stage, output.status, JSON.stringify(stageStatuses)]);

  // Clear regenerating state when carousel slide generation completes
  useEffect(() => {
    if (regeneratingCarouselSlide === null) return;

    const slides = stageData.carousel_slides?.slides || [];
    const regeneratingSlide = slides.find((s: any) => s.slide_number === regeneratingCarouselSlide);

    // If the slide is no longer in 'generating' status, clear the regenerating state
    if (regeneratingSlide && regeneratingSlide.status !== 'generating') {
      setRegeneratingCarouselSlide(null);
    }
  }, [stageData.carousel_slides?.slides, regeneratingCarouselSlide]);

  // Auto-continue scene generation for partial results (long video batching)
  useEffect(() => {
    const scenesData = stageData?.scenes;
    if (
      scenesData?.status === 'generating' &&
      scenesData?.completed_batches &&
      scenesData?.total_batches &&
      scenesData.completed_batches < scenesData.total_batches
    ) {
      console.log(`[MultiStageDetailPanel] Partial scenes detected: ${scenesData.completed_batches}/${scenesData.total_batches}. Continuing generation...`);

      const timer = setTimeout(async () => {
        try {
          const { error } = await supabase.functions.invoke('execute-stage', {
            body: { output_id: output.id, stage_id: 'scenes' }
          });
          if (error) {
            console.error('Failed to continue scene generation:', error);
          }
        } catch (err) {
          console.error('Failed to continue scene generation:', err);
        }
      }, 2000); // Small delay to let DB update propagate

      return () => clearTimeout(timer);
    }
  }, [stageData?.scenes?.completed_batches, stageData?.scenes?.total_batches, output.id]);

  // Image generation hooks
  const generateImage = useGenerateImage();
  const updateOutput = useUpdateContentOutput();
  const regenerateContent = useRegenerateContent();
  const stageApproval = useStageApproval();
  const sceneApproval = useSceneApproval();
  const regenerateScene = useRegenerateScene();
  const regenerateClip = useRegenerateClip();

  // Helper functions for per-output pending state tracking
  const addPendingApproval = (outputId: string) => {
    setPendingStageApprovals(prev => new Set(prev).add(outputId));
  };

  const removePendingApproval = (outputId: string) => {
    setPendingStageApprovals(prev => {
      const next = new Set(prev);
      next.delete(outputId);
      return next;
    });
  };

  const addPendingAssembly = (outputId: string) => {
    setPendingAssembly(prev => new Set(prev).add(outputId));
  };

  const removePendingAssembly = (outputId: string) => {
    setPendingAssembly(prev => {
      const next = new Set(prev);
      next.delete(outputId);
      return next;
    });
  };

  const addPendingRetryAssembly = (outputId: string) => {
    setPendingRetryAssembly(prev => new Set(prev).add(outputId));
  };

  const removePendingRetryAssembly = (outputId: string) => {
    setPendingRetryAssembly(prev => {
      const next = new Set(prev);
      next.delete(outputId);
      return next;
    });
  };

  // Check if this specific output has pending operations
  const isApprovalPending = pendingStageApprovals.has(output.id);
  const isAssemblyPending = pendingAssembly.has(output.id);
  const isRetryAssemblyPending = pendingRetryAssembly.has(output.id);

  const handleGenerateImage = async (prompt: string, instructions?: string) => {
    await generateImage.mutateAsync({
      outputId: output.id,
      prompt,
      instructions,
      jobId
    });
  };

  // Handler for triggering image stage AI generation (for social_media_post)
  const handleTriggerImageGeneration = async (prompt: string, instructions?: string) => {
    try {
      // Update stage status to generating
      const updatedStageData = {
        ...stageData,
        image: {
          ...stageData.image,
          status: 'generating',
          prompt
        }
      };

      await supabase
        .from('content_outputs')
        .update({
          stage_data: updatedStageData,
          status: 'generating'
        })
        .eq('id', output.id);

      // Trigger execute-stage for image with custom prompt and instructions
      const { error } = await supabase.functions.invoke('execute-stage', {
        body: {
          output_id: output.id,
          stage_id: 'image',
          custom_prompt: prompt,
          instructions
        }
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Generating image...');
    } catch (error: any) {
      console.error('Failed to trigger image generation:', error);
      toast.error('Failed to start image generation');
    }
  };

  // Handler for uploading image to image stage
  const handleUpdateImageStage = async (imageUrl: string | null) => {
    try {
      const updatedStageData = {
        ...stageData,
        image: {
          ...stageData.image,
          url: imageUrl,
          status: imageUrl ? 'awaiting_approval' : 'awaiting_input'
        }
      };

      const { error } = await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });

      if (imageUrl) {
        toast.success('Image uploaded successfully');
      }
    } catch (error: any) {
      console.error('Failed to update image stage:', error);
      toast.error('Failed to update image');
    }
  };

  const handleRegenerateStage = async (stageId: string, instructions?: string) => {
    if (pendingStageApprovals.has(output.id)) return; // Prevent double-click

    addPendingApproval(output.id);
    try {
      await regenerateContent.mutateAsync({
        outputId: output.id,
        stageId,
        instructions,
        jobId
      });
    } finally {
      removePendingApproval(output.id);
    }
  };

  const handleProceedToNextStage = async (stageId: string) => {
    if (pendingStageApprovals.has(output.id)) return; // Prevent double-click

    addPendingApproval(output.id);
    try {
      await stageApproval.mutateAsync({
        outputId: output.id,
        stageId,
        action: 'approve',
        jobId
      });
    } finally {
      removePendingApproval(output.id);
    }
  };

  // Handler for updating master prompt in generation_params
  const handleUpdateMasterPrompt = async (newPrompt: string) => {
    try {
      const updatedParams = {
        ...params,
        prompt: newPrompt
      };

      const { error } = await supabase
        .from('content_outputs')
        .update({ generation_params: updatedParams })
        .eq('id', output.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Master prompt updated');
    } catch (error: any) {
      console.error('Failed to update prompt:', error);
      toast.error('Failed to update prompt');
    }
  };

  // Handler for updating image prompt - checks if it's in stage_data or generation_params
  const handleUpdateImagePrompt = async (newPrompt: string) => {
    try {
      // For social_media_post pipeline, image prompt is stored in stage_data.image_prompt.content
      if (stageData.image_prompt?.content !== undefined) {
        const updatedStageData = {
          ...stageData,
          image_prompt: {
            ...stageData.image_prompt,
            content: newPrompt
          }
        };

        const { error } = await supabase
          .from('content_outputs')
          .update({ stage_data: updatedStageData })
          .eq('id', output.id);

        if (error) throw error;
      } else {
        // Fallback: store in generation_params
        const updatedParams = {
          ...params,
          image_prompt: newPrompt
        };

        const { error } = await supabase
          .from('content_outputs')
          .update({ generation_params: updatedParams })
          .eq('id', output.id);

        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Image prompt updated');
    } catch (error: any) {
      console.error('Failed to update image prompt:', error);
      toast.error('Failed to update image prompt');
    }
  };

  // Handler for updating a single section's narration in the outline stage
  const handleUpdateOutlineSection = async (sectionIndex: number, newNarration: string) => {
    try {
      const outlineData = stageData.outline || {};
      const sections = [...(outlineData.sections || [])];
      if (!sections[sectionIndex]) return;

      sections[sectionIndex] = { ...sections[sectionIndex], narration: newNarration };

      const updatedStageData = {
        ...stageData,
        outline: { ...outlineData, sections },
      };

      const { error } = await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output.id);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Section updated');
    } catch (error: any) {
      console.error('Failed to update outline section:', error);
      toast.error('Failed to update section');
    }
  };

  // Handler for updating text content in a stage
  const handleUpdateStageContent = async (stageId: string, newContent: string) => {
    try {
      const updatedStageData = {
        ...stageData,
        [stageId]: {
          ...stageData[stageId],
          content: newContent
        }
      };

      const { error } = await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Content updated');
    } catch (error: any) {
      console.error('Failed to update stage content:', error);
      toast.error('Failed to update content');
    }
  };

  // Use retry assembly hook for final stage
  const retryAssembly = useRetryAssembly();

  const finalStageId = stages[stages.length - 1]?.id || 'final';

  const handleRetryAssembly = async () => {
    if (pendingRetryAssembly.has(output.id)) return;

    addPendingRetryAssembly(output.id);
    try {
      await retryAssembly.mutateAsync({ outputId: output.id, stageId: finalStageId, jobId });
    } finally {
      removePendingRetryAssembly(output.id);
    }
  };

  // Wrapper for triggerAssembly with per-output tracking
  const handleTriggerAssembly = async () => {
    if (pendingAssembly.has(output.id)) return;

    addPendingAssembly(output.id);
    try {
      await triggerAssembly.mutateAsync({ outputId: output.id, stageId: finalStageId, jobId });
    } finally {
      removePendingAssembly(output.id);
    }
  };

  // Video Editor dialog helpers
  const openVideoEditor = useCallback(() => {
    setShowVideoEditor(true);
    videoEditorDialogRef.current?.showModal();
  }, []);

  const closeVideoEditor = useCallback(() => {
    videoEditorDialogRef.current?.close();
    setShowVideoEditor(false);
  }, []);

  // Handle dialog close via Escape key
  useEffect(() => {
    const dialog = videoEditorDialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      closeVideoEditor();
    };

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [closeVideoEditor]);

  // Save edited video from VideoEditor back to stage data
  const handleVideoEditorSave = async (newVideoUrl: string) => {
    try {
      const currentData = stageData[finalStageId] || {};
      const originalUrl = currentData.url || currentData.video_url;

      const updatedStageData = {
        ...stageData,
        [finalStageId]: {
          ...currentData,
          url: newVideoUrl,
          original_video_url: currentData.original_video_url || originalUrl,
          edited: true,
        }
      };

      const { error } = await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Edited video saved!');
      closeVideoEditor();
    } catch (error: any) {
      console.error('Failed to save edited video:', error);
      toast.error('Failed to save edited video');
    }
  };

  // ── Shot editing handlers (video_remix / presenter_video director stage) ──

  const handleUpdateShot = async (shotIndex: number, updates: Record<string, any>) => {
    try {
      const currentShots = stageData.director?.shots || stageData.director?.segments || [];
      const updatedShots = currentShots.map((shot: any, idx: number) =>
        idx === shotIndex ? { ...shot, ...updates } : shot
      );
      const updatedStageData = {
        ...stageData,
        director: { ...stageData.director, shots: updatedShots, segments: updatedShots }
      };
      const { error } = await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
    } catch (error: any) {
      console.error('Failed to update shot:', error);
      toast.error('Failed to update shot');
    }
  };

  const handleReorderShot = async (shotIndex: number, direction: 'up' | 'down') => {
    const currentShots = [...(stageData.director?.shots || stageData.director?.segments || [])];
    const targetIndex = direction === 'up' ? shotIndex - 1 : shotIndex + 1;
    if (targetIndex < 0 || targetIndex >= currentShots.length) return;

    [currentShots[shotIndex], currentShots[targetIndex]] = [currentShots[targetIndex], currentShots[shotIndex]];

    try {
      const updatedStageData = {
        ...stageData,
        director: { ...stageData.director, shots: currentShots, segments: currentShots }
      };
      const { error } = await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output.id);
      if (error) throw error;
      setExpandedShotIndex(targetIndex);
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
    } catch (error: any) {
      console.error('Failed to reorder shot:', error);
      toast.error('Failed to reorder shot');
    }
  };

  const handleDeleteShot = async (shotIndex: number) => {
    const currentShots = [...(stageData.director?.shots || stageData.director?.segments || [])];
    if (currentShots.length <= 1) {
      toast.error('Cannot delete the last shot');
      return;
    }
    currentShots.splice(shotIndex, 1);

    try {
      const updatedStageData = {
        ...stageData,
        director: {
          ...stageData.director,
          shots: currentShots,
          segments: currentShots,
          shot_count: currentShots.length,
          segment_count: currentShots.length,
          total_duration: currentShots.reduce((sum: number, s: any) => sum + (s.duration || 0), 0),
        }
      };
      const { error } = await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output.id);
      if (error) throw error;
      setExpandedShotIndex(null);
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Shot deleted');
    } catch (error: any) {
      console.error('Failed to delete shot:', error);
      toast.error('Failed to delete shot');
    }
  };

  // Gather all available content for saving to library
  const getAvailableContentForSave = () => {
    const available: Array<{
      id: string;
      contentType: 'text' | 'image' | 'video' | 'audio';
      content: Record<string, any>;
      suggestedName: string;
      sourceStage: string;
      preview?: string;
      thumbnailUrl?: string;
    }> = [];

    const finalStage = stageData['final'];
    const scriptStage = stageData['script'];
    const captionStage = stageData['caption'];
    const voiceoverStage = stageData['voiceover'];
    const imageStage = stageData['image'];
    const storyboardStage = stageData['storyboard'];
    const carouselSlidesStage = stageData['carousel_slides'];
    const outlineStage = stageData['outline'];
    const clipsStage = stageData['clips'];
    const textStage = stageData['text']; // video_script pipeline

    // Text stage content (video_script pipeline)
    if (textStage?.content) {
      available.push({
        id: 'text',
        contentType: 'text',
        content: { text: textStage.content, format: 'markdown' },
        suggestedName: `${title || 'Output'} - Script`,
        sourceStage: 'text',
        preview: textStage.content.substring(0, 150) + (textStage.content.length > 150 ? '...' : ''),
      });
    }

    // Caption/text content
    if (captionStage?.content) {
      available.push({
        id: 'caption',
        contentType: 'text',
        content: { text: captionStage.content, format: 'plain' },
        suggestedName: `${title || 'Output'} - Caption`,
        sourceStage: 'caption',
        preview: captionStage.content.substring(0, 150) + (captionStage.content.length > 150 ? '...' : ''),
      });
    }

    // Script text content
    if (scriptStage?.content) {
      available.push({
        id: 'script',
        contentType: 'text',
        content: { text: scriptStage.content, format: 'markdown' },
        suggestedName: `${title || 'Output'} - Script`,
        sourceStage: 'script',
        preview: scriptStage.content.substring(0, 150) + (scriptStage.content.length > 150 ? '...' : ''),
      });
    }

    // Narrative Outline content — build readable text from structured sections
    const outlineText = outlineStage?.sections?.length
      ? (outlineStage.title ? `# ${outlineStage.title}\n\n` : '') +
        outlineStage.sections.map((s: any) =>
          `## ${s.heading || `Section ${s.section_number}`}\n${s.narration || s.key_points?.join(', ') || ''}`
        ).join('\n\n')
      : outlineStage?.content;
    if (outlineText) {
      available.push({
        id: 'outline',
        contentType: 'text',
        content: { text: outlineText, format: 'markdown' },
        suggestedName: `${title || 'Output'} - Narrative Outline`,
        sourceStage: 'outline',
        preview: outlineText.substring(0, 150) + (outlineText.length > 150 ? '...' : ''),
      });
    }

    // Single image (social_media_post)
    const imageUrl = imageStage?.url || imageStage?.image_url;
    if (imageUrl) {
      available.push({
        id: 'image',
        contentType: 'image',
        content: { url: imageUrl, prompt: imageStage?.prompt },
        suggestedName: `${title || 'Output'} - Image`,
        sourceStage: 'image',
        thumbnailUrl: imageUrl,
      });
    }

    // Storyboard images
    if (storyboardStage?.scenes?.length > 0) {
      storyboardStage.scenes.forEach((scene: any, index: number) => {
        if (scene.image_url) {
          available.push({
            id: `storyboard-${scene.scene_number || index + 1}`,
            contentType: 'image',
            content: { url: scene.image_url, prompt: scene.prompt },
            suggestedName: `${title || 'Output'} - Scene ${scene.scene_number || index + 1}`,
            sourceStage: 'storyboard',
            thumbnailUrl: scene.image_url,
          });
        }
      });
    }

    // Carousel slides images
    if (carouselSlidesStage?.slides?.length > 0) {
      carouselSlidesStage.slides.forEach((slide: any, index: number) => {
        if (slide.image_url) {
          available.push({
            id: `carousel-slide-${slide.slide_number || index + 1}`,
            contentType: 'image',
            content: { url: slide.image_url, prompt: slide.prompt },
            suggestedName: `${title || 'Output'} - Carousel Slide ${slide.slide_number || index + 1}`,
            sourceStage: 'carousel_slides',
            thumbnailUrl: slide.image_url,
          });
        }
      });
    }

    // Voiceover/audio (single audio file)
    if (voiceoverStage?.url) {
      available.push({
        id: 'voiceover',
        contentType: 'audio',
        content: {
          url: voiceoverStage.url,
          duration: voiceoverStage.duration,
          transcript: voiceoverStage.script_text,
        },
        suggestedName: `${title || 'Output'} - Voiceover`,
        sourceStage: 'voiceover',
        preview: voiceoverStage.script_text?.substring(0, 100),
      });
    }

    // Voice segments (per-scene audio for storyboard_video_longform)
    const voiceSegmentsStage = stageData['voice_segments'];
    const voiceSegmentsList = Array.isArray(voiceSegmentsStage?.segments) ? voiceSegmentsStage.segments : [];
    if (voiceSegmentsList.length > 0) {
      voiceSegmentsList.forEach((segment: any, index: number) => {
        if (segment.audio_url) {
          available.push({
            id: `voice-segment-${segment.scene_number || index + 1}`,
            contentType: 'audio',
            content: {
              url: segment.audio_url,
              duration: segment.duration,
              character_count: segment.character_count,
            },
            suggestedName: `${title || 'Output'} - Voice Segment ${segment.scene_number || index + 1}`,
            sourceStage: 'voice_segments',
            preview: `Scene ${segment.scene_number || index + 1} narration (${segment.duration}s)`,
          });
        }
      });
    }

    // Video clips (per-clip for storyboard_video_longform/generative_video_oneshot)
    if (clipsStage?.clips?.length > 0) {
      clipsStage.clips.forEach((clip: any, index: number) => {
        if (clip.video_url) {
          available.push({
            id: `clip-${clip.scene_number || index + 1}`,
            contentType: 'video',
            content: {
              url: clip.video_url,
              duration: clip.duration,
              thumbnail_url: clip.source_image,
              prompt: clip.prompt,
            },
            suggestedName: `${title || 'Output'} - Video Clip ${clip.scene_number || index + 1}`,
            sourceStage: 'clips',
            thumbnailUrl: clip.source_image,
          });
        }
      });
    }

    // Final video
    const finalVideoUrl = finalStage?.url || finalStage?.video_url;
    if (finalVideoUrl) {
      available.push({
        id: 'final',
        contentType: 'video',
        content: {
          url: finalVideoUrl,
          duration: finalStage.duration,
          thumbnail_url: finalStage.thumbnail_url,
        },
        suggestedName: `${title || 'Output'} - Final Video`,
        sourceStage: 'final',
        thumbnailUrl: finalStage.thumbnail_url,
      });
    }

    return available;
  };

  // Handler to save content to library
  const handleSaveToLibrary = () => {
    const available = getAvailableContentForSave();
    if (available.length === 0) {
      toast.info('No content available to save yet');
      return;
    }
    setShowSaveDialog(true);
  };

  const handleScenePromptReject = async (stageId: string, sceneNumber: number) => {
    sceneApproval.mutate({
      outputId: output.id,
      stageId: stageId,
      sceneNumber,
      action: 'exclude',
      jobId
    });
  };

  const handleScenePromptEdit = async (stageId: string, sceneNumber: number, newPrompt: string) => {
    // Update the prompt in stage_data and reset status to pending
    const updatedScenes = [...(stageData[stageId]?.scenes || [])];
    // Support both 'scene' (generative_video_oneshot) and 'scene_number' (storyboard_video_longform)
    const sceneIndex = updatedScenes.findIndex(s => (s.scene ?? s.scene_number) === sceneNumber);
    if (sceneIndex !== -1) {
      updatedScenes[sceneIndex] = { 
        ...updatedScenes[sceneIndex], 
        prompt: newPrompt,
        status: 'pending' // Reset to pending when edited
      };
      
      // Update via direct Supabase call since we're updating stage_data
      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            [stageId]: {
              ...stageData[stageId],
              scenes: updatedScenes
            }
          }
        })
        .eq('id', output.id);
      
      if (error) {
        toast.error('Failed to update scene prompt');
        console.error(error);
      } else {
        toast.success('Scene prompt updated');
        queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      }
    }
  };

  const handleSlideContentEdit = async (stageId: string, slideNumber: number, content: SlideFields) => {
    const slidesKey = stageData[stageId]?.slides ? 'slides' : 'scenes';
    const currentSlides = [...(stageData[stageId]?.[slidesKey] || [])];
    const slideIndex = currentSlides.findIndex((s: any) => (s.slide_number ?? s.scene) === slideNumber);
    if (slideIndex === -1) return;

    // merge into the stored slide: layout, list items, stat and compare fields must survive an edit
    currentSlides[slideIndex] = applySlideEdit(currentSlides[slideIndex], content);

    const { error } = await supabase
      .from('content_outputs')
      .update({
        stage_data: {
          ...stageData,
          [stageId]: {
            ...stageData[stageId],
            [slidesKey]: currentSlides,
          },
        },
      })
      .eq('id', output.id);

    if (error) {
      toast.error('Failed to update slide content');
      console.error(error);
    } else {
      toast.success(`Slide ${slideNumber} content updated`);
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
    }
  };

  const handleScenePromptRegenerate = async (stageId: string, sceneNumber: number) => {
    regenerateScene.mutate({
      outputId: output.id,
      stageId: stageId,
      sceneNumber,
      jobId
    });
  };

  const handleScenePromptRegenerateAll = async (stageId: string) => {
    try {
      const { error } = await supabase.functions.invoke('execute-stage', {
        body: {
          output_id: output.id,
          stage_id: stageId,
          regenerate: true
        }
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Regenerating all scene prompts...');
    } catch (error) {
      console.error('Failed to regenerate scene prompts:', error);
      toast.error('Failed to regenerate scene prompts');
    }
  };

  // Enhanced Scene Handlers (for storyboard_video_longform pipeline)
  const handleEnhancedSceneApprove = async (stageId: string, sceneNumber: number) => {
    try {
      const { error } = await supabase.functions.invoke('approve-scene-item', {
        body: {
          output_id: output.id,
          stage_id: stageId,
          scene_number: sceneNumber,
          action: 'approve'
        }
      });

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success(`Scene ${sceneNumber} approved`);
    } catch (error) {
      console.error('Failed to approve enhanced scene:', error);
      toast.error('Failed to approve scene');
    }
  };

  const handleEnhancedSceneExclude = async (stageId: string, sceneNumber: number) => {
    try {
      const { error } = await supabase.functions.invoke('approve-scene-item', {
        body: {
          output_id: output.id,
          stage_id: stageId,
          scene_number: sceneNumber,
          action: 'exclude'
        }
      });

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success(`Scene ${sceneNumber} excluded`);
    } catch (error) {
      console.error('Failed to exclude enhanced scene:', error);
      toast.error('Failed to update scene status');
    }
  };

  const handleEnhancedSceneEdit = async (stageId: string, sceneNumber: number, updates: Partial<{
    narration: string;
    image_prompt: string;
    i2v_prompt: string;
    i2v_motion_type: string;
    duration_seconds: number;
  }>) => {
    try {
      const updatedScenes = [...(stageData[stageId]?.scenes || [])];
      const sceneIndex = updatedScenes.findIndex(s => s.scene_number === sceneNumber);

      if (sceneIndex !== -1) {
        updatedScenes[sceneIndex] = {
          ...updatedScenes[sceneIndex],
          ...updates,
          status: 'pending' // Reset to pending when edited
        };

        const { error } = await supabase
          .from('content_outputs')
          .update({
            stage_data: {
              ...stageData,
              [stageId]: {
                ...stageData[stageId],
                scenes: updatedScenes
              }
            }
          })
          .eq('id', output.id);

        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
        toast.success('Scene updated');
      }
    } catch (error) {
      console.error('Failed to edit enhanced scene:', error);
      toast.error('Failed to update scene');
    }
  };

  const handleEnhancedSceneRegenerate = async (stageId: string, sceneNumber: number) => {
    try {
      setRegeneratingSceneNumber(sceneNumber);

      const { error } = await supabase.functions.invoke('execute-stage', {
        body: {
          output_id: output.id,
          stage_id: stageId,
          regenerate_scene: sceneNumber
        }
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success(`Regenerating scene ${sceneNumber}...`);
    } catch (error) {
      console.error('Failed to regenerate enhanced scene:', error);
      toast.error('Failed to regenerate scene');
    } finally {
      setRegeneratingSceneNumber(null);
    }
  };

  // Scene Image Handlers
  const handleSceneImageRegenerate = (sceneNumber: number, prompt?: string, instructions?: string) => {
    regenerateScene.mutate({
      outputId: output.id,
      stageId: 'storyboard',
      sceneNumber,
      prompt,
      instructions,
      jobId
    });
  };

  const handleSceneImageUpload = async (sceneNumber: number, file: File) => {
    if (!output?.id) return;

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${output.id}/scene_${sceneNumber}_${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('content-media')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('content-media')
        .getPublicUrl(fileName);

      const stageData = (output.stage_data as Record<string, any>) || {};
      const storyboardData = stageData.storyboard || {};
      const scenes = storyboardData.scenes || [];

      const updatedScenes = scenes.map((scene: any) =>
        scene.scene_number === sceneNumber
          ? { ...scene, image_url: urlData.publicUrl, is_uploaded: true, status: 'pending' }
          : scene
      );

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            storyboard: { ...storyboardData, scenes: updatedScenes }
          }
        })
        .eq('id', output.id);

      if (error) throw error;

      toast.success(`Scene ${sceneNumber} image uploaded`);
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
    } catch (error: any) {
      console.error('Error uploading scene image:', error);
      toast.error(error.message || 'Failed to upload image');
    }
  };

  const handleSceneImageReorder = async (fromIndex: number, toIndex: number) => {
    if (!output?.id) return;

    try {
      const stageData = (output.stage_data as Record<string, any>) || {};
      const storyboardData = stageData.storyboard || {};
      const scenes = [...(storyboardData.scenes || [])];

      const [movedScene] = scenes.splice(fromIndex, 1);
      scenes.splice(toIndex, 0, movedScene);

      const reorderedScenes = scenes.map((scene, index) => ({
        ...scene,
        scene_number: index + 1
      }));

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            storyboard: { ...storyboardData, scenes: reorderedScenes }
          }
        })
        .eq('id', output.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
    } catch (error: any) {
      console.error('Error reordering scenes:', error);
      toast.error(error.message || 'Failed to reorder scenes');
    }
  };

  // Handler to exclude a scene image from storyboard
  const handleSceneImageExclude = async (sceneNumber: number) => {
    if (!output?.id) return;

    try {
      const stageDataCurrent = (output.stage_data as Record<string, any>) || {};
      const storyboardData = stageDataCurrent.storyboard || {};
      const scenes = storyboardData.scenes || [];

      const updatedScenes = scenes.map((scene: any) =>
        scene.scene_number === sceneNumber
          ? { ...scene, status: 'excluded' }
          : scene
      );

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageDataCurrent,
            storyboard: { ...storyboardData, scenes: updatedScenes }
          }
        })
        .eq('id', output.id);

      if (error) throw error;

      toast.success(`Scene ${sceneNumber} excluded`, {
        description: 'This scene will be skipped in the final video'
      });
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
    } catch (error: any) {
      console.error('Error excluding scene image:', error);
      toast.error(error.message || 'Failed to exclude scene');
    }
  };

  // Storyboard scene edit handler — maps EnhancedScene fields to storyboard stage_data fields
  const handleStoryboardSceneEdit = async (sceneNumber: number, updates: Partial<{
    narration: string;
    image_prompt: string;
    i2v_prompt: string;
    i2v_motion_type: string;
    duration_seconds: number;
  }>) => {
    if (!output?.id) return;
    try {
      const stageDataCurrent = (output.stage_data as Record<string, any>) || {};
      const storyboardData = stageDataCurrent.storyboard || {};
      const scenes = [...(storyboardData.scenes || [])];

      const sceneIndex = scenes.findIndex((s: any) => s.scene_number === sceneNumber);
      if (sceneIndex === -1) return;

      // Map EnhancedScene fields back to storyboard scene fields
      const mappedUpdates: Record<string, any> = {};
      if (updates.narration !== undefined) mappedUpdates.narration = updates.narration;
      if (updates.image_prompt !== undefined) mappedUpdates.prompt = updates.image_prompt;
      if (updates.i2v_motion_type !== undefined) mappedUpdates.camera_move = updates.i2v_motion_type;
      if (updates.duration_seconds !== undefined) mappedUpdates.duration_seconds = updates.duration_seconds;

      scenes[sceneIndex] = { ...scenes[sceneIndex], ...mappedUpdates };

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageDataCurrent,
            storyboard: { ...storyboardData, scenes }
          }
        })
        .eq('id', output.id);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Scene updated');
    } catch (error: any) {
      console.error('Error editing storyboard scene:', error);
      toast.error(error.message || 'Failed to update scene');
    }
  };

  // Scene Clip Handlers
  const handleClipRegenerate = (sceneNumber: number) => {
    regenerateClip.mutate({
      outputId: output.id,
      stageId: 'clips',
      sceneNumber,
      jobId
    });
  };

  // Handler to exclude a clip from final video
  const handleClipExclude = async (sceneNumber: number) => {
    if (!output?.id) return;

    try {
      const stageDataCurrent = (output.stage_data as Record<string, any>) || {};
      const clipsData = stageDataCurrent.clips || {};
      const clips = clipsData.clips || [];

      const updatedClips = clips.map((clip: any) =>
        clip.scene_number === sceneNumber
          ? { ...clip, status: 'excluded' }
          : clip
      );

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageDataCurrent,
            clips: { ...clipsData, clips: updatedClips }
          }
        })
        .eq('id', output.id);

      if (error) throw error;

      toast.success(`Clip ${sceneNumber} excluded`, {
        description: 'This clip will be skipped in the final video'
      });
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
    } catch (error: any) {
      console.error('Error excluding clip:', error);
      toast.error(error.message || 'Failed to exclude clip');
    }
  };

  // Carousel Style Handler
  const handleCarouselStyleChange = async (newStyle: any) => {
    setIsSavingCarouselStyle(true);
    try {
      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            carousel_style: {
              ...stageData.carousel_style,
              style: newStyle,
              status: 'awaiting_approval' // Keep awaiting_approval so user can use standard approve button
            }
          }
        })
        .eq('id', output.id);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success('Carousel style saved');
    } catch (error: any) {
      console.error('Error saving carousel style:', error);
      toast.error(error.message || 'Failed to save style');
    } finally {
      setIsSavingCarouselStyle(false);
    }
  };

  // Carousel Slide Handlers
  const handleCarouselSlideApprove = async (slideNumber: number) => {
    try {
      const currentSlides = stageData.carousel_slides?.slides || [];
      const updatedSlides = currentSlides.map((slide: any) =>
        slide.slide_number === slideNumber ? { ...slide, status: 'approved' } : slide
      );

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            carousel_slides: { ...stageData.carousel_slides, slides: updatedSlides }
          }
        })
        .eq('id', output.id);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success(`Slide ${slideNumber} approved`);

      // If all slides are now approved, approve the carousel_slides stage to advance the pipeline
      const allApproved = updatedSlides.every((s: any) => s.status === 'approved');
      if (allApproved) {
        await stageApproval.mutateAsync({
          outputId: output.id,
          stageId: 'carousel_slides',
          action: 'approve',
          jobId
        });
      }
    } catch (error: any) {
      console.error('Error approving carousel slide:', error);
      toast.error(error.message || 'Failed to approve slide');
    }
  };

  const handleCarouselSlideReject = async (slideNumber: number) => {
    try {
      const currentSlides = stageData.carousel_slides?.slides || [];
      const updatedSlides = currentSlides.map((slide: any) =>
        slide.slide_number === slideNumber ? { ...slide, status: 'rejected' } : slide
      );

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            carousel_slides: { ...stageData.carousel_slides, slides: updatedSlides }
          }
        })
        .eq('id', output.id);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success(`Slide ${slideNumber} rejected`);
    } catch (error: any) {
      console.error('Error rejecting carousel slide:', error);
      toast.error(error.message || 'Failed to reject slide');
    }
  };

  const handleCarouselSlideRegenerate = async (slideNumber: number, prompt?: string, instructions?: string) => {
    try {
      setRegeneratingCarouselSlide(slideNumber);

      // Update slide status to generating (optimistic update)
      const currentSlides = stageData.carousel_slides?.slides || [];
      const updatedSlides = currentSlides.map((slide: any) =>
        slide.slide_number === slideNumber
          ? { ...slide, status: 'generating', prompt: prompt || slide.prompt }
          : slide
      );

      await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            carousel_slides: { ...stageData.carousel_slides, slides: updatedSlides }
          }
        })
        .eq('id', output.id);

      // Call regenerate API - don't invalidate queries here
      // The realtime subscription will handle updates when generation completes
      const { error } = await supabase.functions.invoke('regenerate-content', {
        body: {
          output_id: output.id,
          stage_id: 'carousel_slides',
          scene_number: slideNumber,
          custom_prompt: prompt,
          instructions
        }
      });

      if (error) throw error;

      // Show toast to inform user - regeneratingCarouselSlide state stays active
      // and will be cleared when the slide status changes from 'generating'
      toast.success(`Regenerating slide ${slideNumber}...`);

      // Don't call invalidateQueries or reset regeneratingCarouselSlide here
      // The UI will update via realtime subscription when generation completes
    } catch (error: any) {
      console.error('Error regenerating carousel slide:', error);
      toast.error(error.message || 'Failed to regenerate slide');
      // Only reset on error
      setRegeneratingCarouselSlide(null);
    }
    // Note: No finally block that resets regeneratingCarouselSlide
    // It will be cleared by the useEffect below when slide status changes
  };

  const handleCarouselSlideUpload = async (slideNumber: number, file: File) => {
    try {
      // Upload to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `carousel-${output.id}-slide-${slideNumber}-${Date.now()}.${fileExt}`;
      const filePath = `carousel-slides/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('content-assets')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('content-assets')
        .getPublicUrl(filePath);

      // Update slide with uploaded image
      const currentSlides = stageData.carousel_slides?.slides || [];
      const updatedSlides = currentSlides.map((slide: any) =>
        slide.slide_number === slideNumber
          ? { ...slide, image_url: publicUrl, status: 'approved' }
          : slide
      );

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            carousel_slides: { ...stageData.carousel_slides, slides: updatedSlides }
          }
        })
        .eq('id', output.id);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success(`Slide ${slideNumber} image uploaded`);
    } catch (error: any) {
      console.error('Error uploading carousel slide:', error);
      toast.error(error.message || 'Failed to upload image');
    }
  };

  const handleCarouselSlideReorder = async (fromIndex: number, toIndex: number) => {
    try {
      const currentSlides = [...(stageData.carousel_slides?.slides || [])];
      const [movedSlide] = currentSlides.splice(fromIndex, 1);
      currentSlides.splice(toIndex, 0, movedSlide);

      // Renumber slides
      const renumberedSlides = currentSlides.map((slide: any, index: number) => ({
        ...slide,
        slide_number: index + 1
      }));

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            carousel_slides: { ...stageData.carousel_slides, slides: renumberedSlides }
          }
        })
        .eq('id', output.id);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
    } catch (error: any) {
      console.error('Error reordering carousel slides:', error);
      toast.error(error.message || 'Failed to reorder slides');
    }
  };

  const handleCarouselSlideContentEdit = async (slideNumber: number, content: SlideContentEdits) => {
    try {
      setRegeneratingCarouselSlide(slideNumber);

      // Update slide text in carousel_content stage data
      const currentContentSlides = stageData.carousel_content?.slides || stageData.carousel_content?.scenes || [];
      const updatedContentSlides = currentContentSlides.map((slide: any) => {
        const sn = slide.slide_number || slide.scene;
        if (sn !== slideNumber) return slide;
        // merge, don't replace: layout, list items, stat and compare fields must survive an edit
        return applySlideEdit(slide, content);
      });
      type SlideText = { slide_number?: number; scene?: number; headline?: string; body?: string };
      const edited = (updatedContentSlides as SlideText[]).find((slide) => (slide.slide_number || slide.scene) === slideNumber);

      // Update slide text on carousel_slides as well (for display); old fit warnings go with the old text
      const currentSlides = stageData.carousel_slides?.slides || [];
      const updatedSlides = currentSlides.map((slide: any) => {
        if (slide.slide_number !== slideNumber) return slide;
        const { render_warnings: _stale, ...rest } = slide;
        return {
          ...rest,
          headline: edited?.headline ?? slide.headline,
          body: edited?.body ?? slide.body,
          status: 'generating',
        };
      });

      const updatedStageData = {
        ...stageData,
        carousel_content: { ...stageData.carousel_content, slides: updatedContentSlides },
        carousel_slides: { ...stageData.carousel_slides, slides: updatedSlides },
      };

      await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', output.id);

      // Trigger re-render of this slide via the regenerate-content edge function
      const { error } = await supabase.functions.invoke('regenerate-content', {
        body: {
          output_id: output.id,
          stage_id: 'carousel_slides',
          scene_number: slideNumber,
        }
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success(`Slide ${slideNumber} text updated — re-rendering...`);
    } catch (error: any) {
      console.error('Error editing carousel slide content:', error);
      toast.error(error.message || 'Failed to update slide content');
      setRegeneratingCarouselSlide(null);
    }
  };

  // Voice Segment Handlers (for storyboard_video_longform audio_gallery stage)
  const handleVoiceSegmentExclude = async (sceneNumber: number) => {
    try {
      const currentSegments = Array.isArray(stageData.voice_segments?.segments) ? stageData.voice_segments.segments : [];
      const updatedSegments = currentSegments.map((segment: any) =>
        segment.scene_number === sceneNumber ? { ...segment, status: 'excluded' } : segment
      );

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            voice_segments: { ...stageData.voice_segments, segments: updatedSegments }
          }
        })
        .eq('id', output.id);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success(`Voice segment ${sceneNumber} excluded`);
    } catch (error: any) {
      console.error('Error excluding voice segment:', error);
      toast.error(error.message || 'Failed to exclude voice segment');
    }
  };

  const handleVoiceSegmentRegenerate = async (sceneNumber: number) => {
    try {
      setRegeneratingVoiceSegment(sceneNumber);

      // Call execute-stage with regenerate_scene parameter
      const { error } = await supabase.functions.invoke('execute-stage', {
        body: {
          output_id: output.id,
          stage_id: 'voice_segments',
          regenerate_scene: sceneNumber
        }
      });

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
      toast.success(`Regenerating voice segment ${sceneNumber}...`);
    } catch (error: any) {
      console.error('Error regenerating voice segment:', error);
      toast.error(error.message || 'Failed to regenerate voice segment');
    } finally {
      setRegeneratingVoiceSegment(null);
    }
  };

  const renderStageContent = (stage: StageConfig) => {
    // For the voice_avatar tab, also check voiceover stage data (backend runs one or the other)
    const resolvedStageData = stageData[stage.id]
      || (stage.id === 'voice_avatar' ? stageData['voiceover'] : null)
      || {};
    const currentStageData = resolvedStageData;
    const resolvedStatus = stageStatuses[stage.id] !== 'pending'
      ? stageStatuses[stage.id]
      : (stage.id === 'voice_avatar' ? stageStatuses['voiceover'] : undefined);
    const isProcessing = resolvedStatus === 'generating';
    const isWaiting = resolvedStatus === 'pending' && (output.status === 'generating' || output.status === 'processing');
    const isFailed = resolvedStatus === 'failed';

    // Show error state for any failed stage (except video which has its own error handling)
    if (isFailed && stage.type !== 'video') {
      const errorMsg = currentStageData.error_message || output.error_message;
      return (
        <div className="space-y-4">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <p className="text-sm text-destructive font-medium mb-2">Stage Failed</p>
            {errorMsg && (
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => handleRegenerateStage(stage.id)}
            disabled={isApprovalPending}
            className="w-full"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {isApprovalPending ? "Retrying..." : "Retry Stage"}
          </Button>
        </div>
      );
    }

    switch (stage.type) {
      case 'composite':
        // ── Transcription viewer (video_remix) ──
        if (stage.id === 'transcribe') {
          if (isProcessing) {
            return <LoadingState message="Transcribing video..." submessage="Extracting speech from audio" />;
          }
          if (isWaiting) {
            return <WaitingState message="Transcription queued" submessage="Waiting for video import to complete" />;
          }
          const transcript = currentStageData.transcript;
          if (!transcript) {
            return (
              <EmptyState
                icon={FileText}
                title="No transcript yet"
                message="The transcript will appear here after transcription completes"
              />
            );
          }
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {currentStageData.language && <span>Language: {currentStageData.language}</span>}
                {currentStageData.word_count && <span>{currentStageData.word_count} words</span>}
                {currentStageData.duration_seconds && (
                  <span>Duration: {Math.floor(currentStageData.duration_seconds / 60)}:{String(Math.round(currentStageData.duration_seconds % 60)).padStart(2, '0')}</span>
                )}
              </div>
              <TextContentSection
                content={transcript}
                onUpdate={async (newContent) => {
                  try {
                    const updatedStageData = {
                      ...stageData,
                      [stage.id]: {
                        ...stageData[stage.id],
                        transcript: newContent
                      }
                    };
                    const { error } = await supabase
                      .from('content_outputs')
                      .update({ stage_data: updatedStageData })
                      .eq('id', output.id);
                    if (error) throw error;
                    queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
                  } catch (error: any) {
                    console.error('Failed to update transcript:', error);
                    toast.error('Failed to update transcript');
                  }
                }}
                onRegenerate={(instructions) => handleRegenerateStage(stage.id, instructions)}
                isRegenerating={isApprovalPending}
                contentLabel="Transcript"
              />
              {currentStageData.segments?.length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-muted-foreground">Segments</h4>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {currentStageData.segments.map((seg: any, i: number) => (
                      <div key={i} className="flex gap-2 text-xs">
                        <span className="text-muted-foreground font-mono shrink-0">
                          {Math.floor(seg.start / 60)}:{String(Math.round(seg.start % 60)).padStart(2, '0')}
                        </span>
                        <span>{seg.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transcript → Shot mapping (shown once director stage is complete) */}
              {(stageData?.director?.shots?.length > 0 || stageData?.director?.segments?.length > 0) && (
                <div className="space-y-2 border-t pt-4">
                  <h4 className="text-sm font-medium text-muted-foreground">Shot Narration Mapping</h4>
                  <p className="text-xs text-muted-foreground">How the director assigned your transcript to each shot.</p>
                  <div className="space-y-1.5">
                    {(stageData.director.shots || stageData.director.segments).map((shot: any, si: number) => (
                      <div key={si} className="flex gap-2 items-start text-xs p-2 rounded bg-muted/30">
                        <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5">Shot {si + 1}</Badge>
                        <span className="text-muted-foreground">{shot.narration || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        }

        // ── Web capture / video ingest screenshot viewer ──
        if (isProcessing) {
          return <LoadingState message="Capturing web page..." submessage="Taking screenshots and analyzing page structure" />;
        }
        if (isWaiting) {
          return <WaitingState message="Web capture queued" submessage="Waiting for previous stages to complete" />;
        }
        const screenshots = currentStageData.screenshots || currentStageData.content?.screenshots;
        const pageMeta = currentStageData.page_metadata || currentStageData.content?.page_metadata;
        if (!screenshots || screenshots.length === 0) {
          return (
            <EmptyState
              icon={Layers}
              title="No screenshots yet"
              message="Screenshots will appear here after the web capture completes"
            />
          );
        }
        return (
          <div className="space-y-4">
            {pageMeta && (
              <div className="p-3 bg-muted/50 rounded-lg space-y-1">
                <p className="text-sm font-medium">{pageMeta.title}</p>
                {pageMeta.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{pageMeta.description}</p>
                )}
                {pageMeta.url && (
                  <p className="text-xs text-muted-foreground truncate">{pageMeta.url}</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {screenshots.map((s: any, i: number) => (
                <div key={i} className="space-y-1">
                  <img
                    src={s.url}
                    alt={s.narration_hint || `Screenshot ${i + 1}`}
                    className="w-full rounded-md border"
                  />
                  {s.narration_hint && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{s.narration_hint}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{screenshots.length} screenshot{screenshots.length !== 1 ? 's' : ''} captured</p>
          </div>
        );

      case 'text':
      case 'script':
        if (isProcessing) {
          return <LoadingState message="Generating content..." submessage="AI is writing your content" />;
        }
        if (isWaiting) {
          return <WaitingState message="Content generation queued" submessage="Waiting for previous stages to complete" />;
        }

        // Director stage: shot list data (shots array at top level, no 'content' field)
        // video_remix stores as 'segments', presenter_video/video as 'shots' — support both
        const directorShots = currentStageData.shots || currentStageData.segments;
        if (directorShots && Array.isArray(directorShots)) {
          const shots = directorShots as any[];
          const allScreenshots = stageData?.web_capture?.screenshots || stageData?.video_ingest?.screenshots || [];
          const bRollStageData = stageData?.b_roll;
          // Use pipeline type, not data shape — remix parser adds both 'segments' AND 'shots' keys
          const isRemixPipeline = output.pipeline === 'video_remix';
          // Orientation for preview dimensions
          const previewOrientation = output.generation_params?.video_config?.orientation || output.generation_params?.presenter_config?.orientation || 'portrait';
          const previewIsLandscape = previewOrientation === 'landscape';
          const previewWidth = previewIsLandscape ? 1920 : 1080;
          const previewHeight = previewIsLandscape ? 1080 : 1920;
          const previewPaddingBottom = previewIsLandscape ? '56.25%' : '177.78%'; // 9/16 or 16/9
          return (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Badge variant="secondary">{shots.length} {isRemixPipeline ? 'segments' : 'shots'}</Badge>
                <span>{currentStageData.total_duration || shots.reduce((sum: number, s: any) => sum + (s.duration || 0), 0)}s total</span>
                {currentStageData.template_type && (
                  <Badge variant="outline">{currentStageData.template_type}</Badge>
                )}
              </div>

              {/* Shot list — expandable & editable */}
              <div className="space-y-2">
                {shots.map((shot: any, i: number) => {
                  // Detect remix segments: only when pipeline uses 'segments' key (video_remix).
                  // The unified 'video' pipeline uses 'shots' with source_start: null in schema,
                  // so field-based detection (source_start !== undefined) gives false positives.
                  const isRemixSegment = isRemixPipeline && (shot.source_start !== undefined || shot.type === 'video' || shot.type === 'text_card' || shot.type === 'b_roll');
                  const screenshotUrl = shot.screenshot_index != null
                    ? allScreenshots[shot.screenshot_index]?.url
                    : null;
                  // For remix segments, find nearest frame by time position
                  const remixFrameUrl = isRemixSegment && allScreenshots.length > 0 && shot.type === 'video'
                    ? (() => {
                        const videoDuration = stageData?.transcribe?.duration_seconds || stageData?.video_ingest?.video_duration_seconds || 1;
                        const midpoint = ((shot.source_start || 0) + (shot.source_end || 0)) / 2;
                        const frameIndex = Math.min(
                          allScreenshots.length - 1,
                          Math.max(0, Math.round((midpoint / videoDuration) * allScreenshots.length))
                        );
                        return allScreenshots[frameIndex]?.url;
                      })()
                    : null;
                  const thumbnailUrl = screenshotUrl || remixFrameUrl;
                  const isExpanded = expandedShotIndex === i;
                  const isPreviewing = previewingShotIndex === i;
                  const isBRollShot = isRemixSegment
                    ? shot.type === 'b_roll'
                    : (shot.layout === 'b_roll_cutaway' || shot.layout === 'b_roll_fullscreen');
                  const isTextCard = isRemixSegment && shot.type === 'text_card';
                  const shotBRollClips = bRollStageData?.b_roll_by_shot?.[i]?.clips || [];
                  const sourceVideoUrl = stageData?.video_ingest?.source_url;
                  const isTextOnlyLayout = ['text_card', 'stat_card', 'quote_card', 'list_reveal', 'gradient_title'].includes(shot.layout);
                  const canPreview = isRemixSegment
                    ? (shot.type === 'video' && !!sourceVideoUrl) || shot.type === 'text_card'
                    : (!!shot.layout && (!!shot.camera || isTextOnlyLayout));

                  // Format time as M:SS
                  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

                  return (
                    <div
                      key={i}
                      className={`border rounded-lg overflow-hidden transition-colors ${isBRollShot ? 'border-amber-500/40 bg-amber-500/5' : ''} ${isTextCard ? 'border-blue-500/40 bg-blue-500/5' : ''} ${isExpanded ? 'ring-1 ring-primary/30' : ''}`}
                    >
                      {/* Collapsed header — always visible */}
                      <button
                        type="button"
                        className="w-full p-3 flex items-start gap-3 text-left hover:bg-muted/30 transition-colors"
                        onClick={() => setExpandedShotIndex(isExpanded ? null : i)}
                      >
                        {/* Expand/collapse icon */}
                        <div className="mt-0.5 shrink-0">
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        </div>

                        {/* Screenshot thumbnail */}
                        {thumbnailUrl ? (
                          <img
                            src={thumbnailUrl}
                            alt={isRemixSegment ? `Frame at ${fmtTime(shot.source_start || 0)}` : `Frame ${shot.screenshot_index}`}
                            className="w-14 h-24 object-cover rounded border flex-shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-24 bg-muted rounded border flex-shrink-0 flex items-center justify-center">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0 space-y-1">
                          {/* Shot header badges */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{isRemixSegment ? `Segment ${i + 1}` : `Shot ${i + 1}`}</span>
                            {isRemixSegment ? (
                              <>
                                <Badge variant="outline" className="text-xs">
                                  {shot.type === 'video' ? 'Video' : shot.type === 'text_card' ? 'Text Card' : shot.type === 'b_roll' ? 'B-Roll' : shot.type}
                                </Badge>
                                {shot.type === 'video' && (
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {fmtTime(shot.source_start || 0)} – {fmtTime(shot.source_end || 0)}
                                  </span>
                                )}
                                <span className="text-xs text-muted-foreground">{shot.duration?.toFixed(1)}s</span>
                                {shot.speed && shot.speed !== 1 && (
                                  <Badge variant="secondary" className="text-xs">{shot.speed}x</Badge>
                                )}
                              </>
                            ) : (
                              <>
                                {isBRollShot && <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-500">B-Roll</Badge>}
                                <Badge variant="outline" className="text-xs">{LAYOUT_OPTIONS.find(l => l.value === shot.layout)?.label || shot.layout}</Badge>
                                <span className="text-xs text-muted-foreground">{shot.duration}s</span>
                                {shot.camera?.move && shot.camera.move !== 'hold' && (
                                  <Badge variant="secondary" className="text-xs">{CAMERA_MOVES.find(c => c.value === shot.camera.move)?.label || shot.camera.move}</Badge>
                                )}
                              </>
                            )}
                            {shot.transition_in && shot.transition_in !== 'cut_hard' && (
                              <Badge variant="secondary" className="text-xs">{TRANSITIONS.find(t => t.value === shot.transition_in)?.label || shot.transition_in}</Badge>
                            )}
                            {shot.sound_effect && (
                              <Badge variant="secondary" className="text-xs">{shot.sound_effect}</Badge>
                            )}
                          </div>

                          {/* Card text for text_card segments */}
                          {isTextCard && shot.card_text && (
                            <p className="text-sm font-medium text-blue-400 line-clamp-1">{shot.card_text}</p>
                          )}

                          {/* Narration preview */}
                          <p className="text-sm text-muted-foreground line-clamp-2">{shot.narration}</p>
                        </div>

                        {/* Play preview button */}
                        {canPreview && (
                          <div className="shrink-0 self-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPreviewing) {
                                setPreviewingShotIndex(null);
                              } else {
                                setPreviewingShotIndex(i);
                                setExpandedShotIndex(i);
                              }
                            }}
                          >
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center cursor-pointer transition-colors ${isPreviewing ? 'bg-cta text-black' : 'hover:bg-muted text-muted-foreground hover:text-foreground'}`}>
                              {isPreviewing ? <ChevronDown className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                            </div>
                          </div>
                        )}
                      </button>

                      {/* Expanded editing panel */}
                      {isExpanded && (
                        <div className="border-t px-3 py-4 space-y-4 bg-muted/10">
                          {/* Inline Remotion shot preview (presenter shots) */}
                          {isPreviewing && !isRemixSegment && shot.layout && (shot.camera || isTextOnlyLayout) && (
                            <div className="rounded-lg overflow-hidden border border-border bg-black mx-auto" style={{ width: '100%', maxWidth: previewIsLandscape ? 640 : 400 }}>
                              <div style={{ position: 'relative', width: '100%', paddingBottom: previewPaddingBottom }}>
                                <Player
                                  acknowledgeRemotionLicense
                                  component={ShotPreviewComposition}
                                  inputProps={{
                                    shot: shot as Shot,
                                    screenshots: (allScreenshots || []).map((s: any) => ({
                                      url: s.url,
                                      elements: [],
                                    })) as ScreenshotData[],
                                    brand: DEFAULT_BRAND,
                                  }}
                                  durationInFrames={Math.max(1, Math.round((shot.duration || 4) * 30))}
                                  fps={30}
                                  compositionWidth={previewWidth}
                                  compositionHeight={previewHeight}
                                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                                  controls
                                  autoPlay
                                  loop
                                />
                              </div>
                            </div>
                          )}

                          {/* Video preview (remix video segments) */}
                          {isPreviewing && isRemixSegment && shot.type === 'video' && sourceVideoUrl && (
                            <div className="rounded-lg overflow-hidden border border-border bg-black mx-auto w-full">
                              <video
                                src={`${sourceVideoUrl}#t=${shot.source_start || 0},${shot.source_end || 0}`}
                                controls
                                autoPlay
                                className="w-full"
                                onLoadedMetadata={(e) => {
                                  const video = e.currentTarget;
                                  video.currentTime = shot.source_start || 0;
                                  video.playbackRate = shot.speed || 1;
                                }}
                                onTimeUpdate={(e) => {
                                  const video = e.currentTarget;
                                  if (video.currentTime >= (shot.source_end || video.duration)) {
                                    video.pause();
                                    video.currentTime = shot.source_start || 0;
                                  }
                                }}
                              />
                              <div className="px-2 py-1.5 bg-muted/50 text-xs text-muted-foreground text-center">
                                {fmtTime(shot.source_start || 0)} – {fmtTime(shot.source_end || 0)} @ {shot.speed || 1}x
                              </div>
                            </div>
                          )}

                          {/* Text card preview (remix text_card segments) */}
                          {isPreviewing && isRemixSegment && shot.type === 'text_card' && (
                            <div className="rounded-lg border border-border bg-black mx-auto w-full p-8 text-center">
                              <p className="text-xl font-bold text-white">{shot.card_text || shot.narration || 'Text Card'}</p>
                              {shot.card_subtitle && (
                                <p className="text-sm text-muted-foreground mt-2">{shot.card_subtitle}</p>
                              )}
                            </div>
                          )}

                          {/* Toolbar: reorder + delete */}
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReorderShot(i, 'up')}
                              disabled={i === 0}
                              title="Move up"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReorderShot(i, 'down')}
                              disabled={i === shots.length - 1}
                              title="Move down"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteShot(i)}
                              className="text-destructive hover:text-destructive"
                              title="Delete shot"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>

                          {/* Narration */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Narration</label>
                            <Textarea
                              defaultValue={shot.narration || ''}
                              onBlur={(e) => {
                                if (e.target.value !== shot.narration) {
                                  handleUpdateShot(i, { narration: e.target.value });
                                }
                              }}
                              className="text-sm min-h-[60px]"
                              placeholder="What the narrator says during this segment..."
                            />
                          </div>

                          {/* Card text (remix text_card segments) */}
                          {isRemixSegment && shot.type === 'text_card' && (
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">Card Text</label>
                              <Input
                                defaultValue={shot.card_text || ''}
                                onBlur={(e) => {
                                  if (e.target.value !== (shot.card_text || '')) {
                                    handleUpdateShot(i, { card_text: e.target.value || null });
                                  }
                                }}
                                className="h-8 text-xs"
                                placeholder="Bold display text..."
                              />
                            </div>
                          )}

                          {isRemixSegment ? (
                            <>
                              {/* Remix segment editing: Type + Duration */}
                              <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Type</label>
                                  <Select
                                    defaultValue={shot.type || 'video'}
                                    onValueChange={(value) => handleUpdateShot(i, { type: value })}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="video" className="text-xs">Video</SelectItem>
                                      <SelectItem value="text_card" className="text-xs">Text Card</SelectItem>
                                      <SelectItem value="b_roll" className="text-xs">B-Roll</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Speed</label>
                                  <Input
                                    type="number"
                                    min={0.5}
                                    max={2}
                                    step={0.25}
                                    defaultValue={shot.speed || 1}
                                    onBlur={(e) => {
                                      const val = parseFloat(e.target.value);
                                      if (!isNaN(val) && val !== shot.speed) {
                                        handleUpdateShot(i, { speed: Math.max(0.5, Math.min(2, val)) });
                                      }
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Duration (s)</label>
                                  <Input
                                    type="number"
                                    min={0.5}
                                    max={30}
                                    step={0.5}
                                    defaultValue={shot.duration || 3}
                                    onBlur={(e) => {
                                      const val = parseFloat(e.target.value);
                                      if (!isNaN(val) && val !== shot.duration) {
                                        handleUpdateShot(i, { duration: val });
                                      }
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                              </div>

                              {/* Source time range (video segments) */}
                              {shot.type === 'video' && (
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Source Start (s)</label>
                                    <Input
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      defaultValue={shot.source_start || 0}
                                      onBlur={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val) && val !== shot.source_start) {
                                          handleUpdateShot(i, { source_start: val });
                                        }
                                      }}
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Source End (s)</label>
                                    <Input
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      defaultValue={shot.source_end || 0}
                                      onBlur={(e) => {
                                        const val = parseFloat(e.target.value);
                                        if (!isNaN(val) && val !== shot.source_end) {
                                          handleUpdateShot(i, { source_end: val });
                                        }
                                      }}
                                      className="h-8 text-xs"
                                    />
                                  </div>
                                </div>
                              )}

                              {/* Transition + Sound Effect */}
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Transition</label>
                                  <Select
                                    defaultValue={shot.transition_in || 'cut_hard'}
                                    onValueChange={(value) => handleUpdateShot(i, { transition_in: value })}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {TRANSITIONS.map(opt => (
                                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Sound Effect</label>
                                  <Select
                                    defaultValue={shot.sound_effect || '_none'}
                                    onValueChange={(value) => handleUpdateShot(i, { sound_effect: value === '_none' ? null : value })}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {SOUND_EFFECTS.map(opt => (
                                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              {/* Text Overlay */}
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Text Overlay</label>
                                <Input
                                  defaultValue={shot.text_overlay || ''}
                                  onBlur={(e) => {
                                    if (e.target.value !== (shot.text_overlay || '')) {
                                      handleUpdateShot(i, { text_overlay: e.target.value || null });
                                    }
                                  }}
                                  className="h-8 text-xs"
                                  placeholder="On-screen text..."
                                />
                              </div>
                            </>
                          ) : (
                            <>
                              {/* Presenter shot editing: Layout + Duration */}
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Layout</label>
                                  <Select
                                    defaultValue={shot.layout || 'screenshot_fullscreen'}
                                    onValueChange={(value) => handleUpdateShot(i, { layout: value })}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {LAYOUT_OPTIONS.map(opt => (
                                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Duration (s)</label>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={30}
                                    step={0.5}
                                    defaultValue={shot.duration || 4}
                                    onBlur={(e) => {
                                      const val = parseFloat(e.target.value);
                                      if (!isNaN(val) && val !== shot.duration) {
                                        handleUpdateShot(i, { duration: val });
                                      }
                                    }}
                                    className="h-8 text-xs"
                                  />
                                </div>
                              </div>

                              {/* Camera Move + Transition */}
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Camera</label>
                                  <Select
                                    defaultValue={shot.camera?.move || 'ken_burns_slow'}
                                    onValueChange={(value) => handleUpdateShot(i, { camera: { ...shot.camera, move: value } })}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {CAMERA_MOVES.map(opt => (
                                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Transition</label>
                                  <Select
                                    defaultValue={shot.transition_in || 'cut_hard'}
                                    onValueChange={(value) => handleUpdateShot(i, { transition_in: value })}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {TRANSITIONS.map(opt => (
                                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              {/* Sound Effect + Text Overlay */}
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Sound Effect</label>
                                  <Select
                                    defaultValue={shot.sound_effect || '_none'}
                                    onValueChange={(value) => handleUpdateShot(i, { sound_effect: value === '_none' ? null : value })}
                                  >
                                    <SelectTrigger className="h-8 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {SOUND_EFFECTS.map(opt => (
                                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Text Overlay</label>
                                  <Input
                                    defaultValue={shot.text_overlay || ''}
                                    onBlur={(e) => {
                                      if (e.target.value !== (shot.text_overlay || '')) {
                                        handleUpdateShot(i, { text_overlay: e.target.value || null });
                                      }
                                    }}
                                    className="h-8 text-xs"
                                    placeholder="On-screen text..."
                                  />
                                </div>
                              </div>

                              {/* Frame picker — show available frames as selectable thumbnails */}
                              {allScreenshots.length > 1 && (
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-muted-foreground">Source Frame</label>
                                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                                    {allScreenshots.map((s: any, fi: number) => (
                                      <button
                                        key={fi}
                                        type="button"
                                        className={`shrink-0 w-12 h-20 rounded border-2 overflow-hidden transition-colors ${shot.screenshot_index === fi ? 'border-primary ring-1 ring-primary/30' : 'border-transparent opacity-60 hover:opacity-100'}`}
                                        onClick={() => handleUpdateShot(i, { screenshot_index: fi })}
                                        title={`Frame ${fi + 1}`}
                                      >
                                        <img src={s.url} alt={`Frame ${fi + 1}`} className="w-full h-full object-cover" />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}

                          {/* B-Roll clips preview (if b_roll stage has data for this shot) */}
                          {shotBRollClips.length > 0 && (
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">B-Roll Clips</label>
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                {shotBRollClips.map((clip: any, ci: number) => (
                                  <div key={ci} className="shrink-0 w-20 space-y-1">
                                    {clip.thumbnail || clip.url ? (
                                      <img src={clip.thumbnail || clip.url} alt={clip.label || 'B-Roll'} className="w-20 h-14 object-cover rounded border" />
                                    ) : (
                                      <div className="w-20 h-14 bg-muted rounded border flex items-center justify-center">
                                        <Film className="w-4 h-4 text-muted-foreground" />
                                      </div>
                                    )}
                                    <p className="text-[10px] text-muted-foreground truncate">{clip.label || clip.keywords?.join(', ') || 'Clip'}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* B-Roll keywords (editable tags) */}
                          {shot.b_roll_keywords && shot.b_roll_keywords.length > 0 && (
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-muted-foreground">B-Roll Keywords</label>
                              <div className="flex gap-1 flex-wrap">
                                {shot.b_roll_keywords.map((kw: string, ki: number) => (
                                  <Badge key={ki} variant="secondary" className="text-xs gap-1">
                                    {kw}
                                    <button
                                      type="button"
                                      className="ml-0.5 hover:text-destructive"
                                      onClick={() => {
                                        const newKeywords = shot.b_roll_keywords.filter((_: any, idx: number) => idx !== ki);
                                        handleUpdateShot(i, { b_roll_keywords: newKeywords });
                                      }}
                                    >
                                      ×
                                    </button>
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Full script (collapsible) */}
              {currentStageData.full_script && (
                <details className="border-t pt-4">
                  <summary className="text-sm font-medium cursor-pointer select-none">Full Script</summary>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2">{currentStageData.full_script}</p>
                </details>
              )}

              {/* Banner: Visual editor available when composition has editor_state */}
              {stageData['composition']?.editor_state?.tracks?.length > 0 && (
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Visual editor available</p>
                    <p className="text-xs text-muted-foreground">Edit tracks, timing, and effects in the studio</p>
                  </div>
                  <Button variant="cta" size="sm" onClick={openVideoEditor} className="gap-2">
                    <Film className="h-3.5 w-3.5" />
                    Open Editor Studio
                  </Button>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRegenerateStage(stage.id, '')}
                  disabled={isApprovalPending}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Regenerate Shot List
                </Button>
              </div>
            </div>
          );
        }

        // Structured outline with sections + narration (storyboard_video_longform)
        if (currentStageData.sections?.length > 0) {
          const sections = currentStageData.sections as any[];
          const totalWords = sections.reduce((sum: number, s: any) => sum + (s.narration || '').split(/\s+/).filter(Boolean).length, 0);
          const totalDuration = currentStageData.total_duration_seconds || sections.reduce((sum: number, s: any) => sum + (s.duration_seconds || 0), 0);
          const ROLE_COLORS: Record<string, string> = {
            hook: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
            problem: 'bg-red-500/15 text-red-400 border-red-500/30',
            insight: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
            solution: 'bg-green-500/15 text-green-400 border-green-500/30',
            proof: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
            cta: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
          };

          return (
            <div className="space-y-4">
              {/* Header with title + stats */}
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  {currentStageData.title && (
                    <h3 className="text-base font-semibold truncate">{currentStageData.title}</h3>
                  )}
                  {currentStageData.hook && (
                    <p className="text-sm text-muted-foreground mt-0.5 italic">"{currentStageData.hook}"</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 text-sm text-muted-foreground">
                  <span>{totalWords.toLocaleString()} words</span>
                  <span>·</span>
                  <span>~{totalDuration}s</span>
                  <span>·</span>
                  <span>{sections.length} sections</span>
                </div>
              </div>

              {/* Sections */}
              <div className="space-y-3">
                {sections.map((section: any, i: number) => {
                  const sectionWords = (section.narration || '').split(/\s+/).filter(Boolean).length;
                  const roleColor = ROLE_COLORS[section.narrative_role] || 'bg-muted text-muted-foreground border-border';

                  return (
                    <div key={i} className="border rounded-lg p-4 space-y-2">
                      {/* Section header row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground">#{section.section_number || i + 1}</span>
                        <span className="text-sm font-medium">{section.heading || `Section ${i + 1}`}</span>
                        {section.narrative_role && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${roleColor}`}>
                            {section.narrative_role}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {section.duration_seconds}s · {sectionWords} words
                        </span>
                      </div>

                      {/* Editable narration */}
                      <Textarea
                        defaultValue={section.narration || ''}
                        onBlur={(e) => {
                          if (e.target.value !== section.narration) {
                            handleUpdateOutlineSection(i, e.target.value);
                          }
                        }}
                        className="text-sm min-h-[60px] leading-relaxed"
                        placeholder="Narration text for this section..."
                      />
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRegenerateStage(stage.id, '')}
                  disabled={isApprovalPending}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Regenerate Outline
                </Button>
              </div>
            </div>
          );
        }

        return currentStageData.content ? (
          <TextContentSection
            content={currentStageData.content}
            onUpdate={(newContent) => handleUpdateStageContent(stage.id, newContent)}
            onRegenerate={(instructions) => handleRegenerateStage(stage.id, instructions)}
            isRegenerating={isApprovalPending}
            contentLabel={stage.label}
          />
        ) : (
          <EmptyState
            icon={FileText}
            title={`No ${stage.label.toLowerCase()} yet`}
            message={`${stage.label} will appear here once generated`}
          />
        );

      case 'text_gallery':
        if (isProcessing) {
          const isCarousel = output.pipeline === 'instagram_carousel';
          const isSlidePrompts = stage.id === 'carousel_slide_prompts';
          return <LoadingState
            message={isCarousel
              ? (isSlidePrompts ? "Generating image prompts..." : "Generating slide content...")
              : "Generating scene prompts..."
            }
            submessage={isCarousel
              ? (isSlidePrompts ? "AI is creating detailed image prompts for each slide" : "AI is creating content for each slide")
              : "AI is creating prompts for each scene"
            }
          />;
        }
        if (isWaiting) {
          const isCarousel = output.pipeline === 'instagram_carousel';
          const isSlidePrompts = stage.id === 'carousel_slide_prompts';
          return <WaitingState
            message={isCarousel
              ? (isSlidePrompts ? "Image prompts queued" : "Slide content queued")
              : "Scene prompts queued"
            }
            submessage="Waiting for previous stages to complete"
          />;
        }

        // Support both scenes (video pipelines) and slides (carousel pipeline)
        const textGalleryItems = currentStageData.scenes || currentStageData.slides;

        return textGalleryItems ? (
          <ScenePromptsViewer
            scenePrompts={textGalleryItems}
            onExclude={(sceneNumber) => handleScenePromptReject(stage.id, sceneNumber)}
            onEdit={(sceneNumber, newPrompt) => handleScenePromptEdit(stage.id, sceneNumber, newPrompt)}
            onEditSlideContent={stage.id === 'carousel_content' ? (slideNumber, content) => handleSlideContentEdit(stage.id, slideNumber, content) : undefined}
            onRegenerate={(sceneNumber) => handleScenePromptRegenerate(stage.id, sceneNumber)}
            onRegenerateAll={() => handleScenePromptRegenerateAll(stage.id)}
            isRegeneratingScene={regeneratingSceneNumber}
          />
        ) : (
          <EmptyState
            icon={Sparkles}
            title="No prompts yet"
            message="Scene prompts will appear here after generation"
          />
        );

      case 'scene_gallery':
        if (isProcessing) {
          // Show progress for batched generation
          const completedBatches = currentStageData?.completed_batches || 0;
          const totalBatches = currentStageData?.total_batches || 0;
          const sceneCount = currentStageData?.scenes?.length || 0;
          const progressMsg = totalBatches > 0
            ? `Batch ${completedBatches}/${totalBatches} complete (${sceneCount} scenes generated)`
            : 'AI is creating detailed scenes with narration, prompts, and motion settings';
          return <LoadingState message="Generating scene breakdown..." submessage={progressMsg} />;
        }
        if (isWaiting) {
          return <WaitingState message="Scene breakdown queued" submessage="Waiting for narrative outline to complete" />;
        }

        // Extract voiceover data for scene preview
        const sceneVoiceoverData = stageData['full_voiceover'] || stageData['voiceover'];
        const sceneVoiceoverUrl = sceneVoiceoverData?.audio_url || sceneVoiceoverData?.url;
        const sceneWordTimestamps = sceneVoiceoverData?.word_timestamps;

        return currentStageData.scenes ? (
          <EnhancedSceneViewer
            scenes={currentStageData.scenes || []}
            voiceoverUrl={sceneVoiceoverUrl}
            wordTimestamps={sceneWordTimestamps}
            onExclude={(sceneNumber) => handleEnhancedSceneExclude(stage.id, sceneNumber)}
            onEdit={(sceneNumber, updates) => handleEnhancedSceneEdit(stage.id, sceneNumber, updates)}
            onRegenerate={(sceneNumber) => handleEnhancedSceneRegenerate(stage.id, sceneNumber)}
            isRegeneratingScene={regeneratingSceneNumber}
          />
        ) : (
          <EmptyState
            icon={LayoutGrid}
            title="No scene breakdown yet"
            message="Scenes with narration and prompts will appear here after generation"
          />
        );

      case 'image':
        if (isProcessing) {
          return <LoadingState message="Generating image..." submessage="AI is creating your visual" />;
        }
        if (isWaiting) {
          return <WaitingState message="Image generation queued" submessage="Waiting for previous stages to complete" />;
        }

        // For social_media_post: use the trigger handler that calls execute-stage
        // This handles both upload and AI generation
        const isSocialMediaPost = output.pipeline === 'social_media_post';

        return (
          <ImageContentSection
            imageUrl={currentStageData.url || currentStageData.image_url || currentStageData.images?.[0]}
            imagePrompt={currentStageData.prompt}
            isRequired={stage.required}
            onGenerateImage={isSocialMediaPost ? handleTriggerImageGeneration : handleGenerateImage}
            onRegenerateImage={isSocialMediaPost ? handleTriggerImageGeneration : handleGenerateImage}
            onUpdateImage={isSocialMediaPost ? handleUpdateImageStage : undefined}
            isGenerating={generateImage.isPending || stageStatuses[stage.id] === 'generating'}
          />
        );
      
      case 'image_gallery':
        if (isProcessing) {
          return <LoadingState message="Generating storyboard images..." submessage="AI is creating visuals for each scene" />;
        }
        if (isWaiting) {
          return <WaitingState message="Storyboard queued" submessage="Waiting for previous stages to complete" />;
        }

        // Check if some scenes are still generating (have no image yet)
        const scenesArray = currentStageData.scenes || [];
        const scenesStillGenerating = scenesArray.filter((s: any) => !s.image_url && s.status !== 'failed').length;
        const isStoryboardPartiallyGenerating = scenesStillGenerating > 0 && currentStageData.status === 'generating';

        // Check if all scenes have images (ready for editing)
        const completedScenes = scenesArray.filter((s: any) => s.image_url);
        const hasVoiceover = !!(stageData['full_voiceover']?.audio_url || stageData['voiceover']?.audio_url || stageData['voiceover']?.url);
        const canEditScenes = completedScenes.length >= 2 && hasVoiceover;

        return (
          <div className="space-y-4">
            {isStoryboardPartiallyGenerating && (
              <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-primary">
                  Generating images... {scenesArray.length - scenesStillGenerating}/{scenesArray.length} complete
                </span>
              </div>
            )}
            <StageContentViewer
              stageType="image_gallery"
              stageData={currentStageData}
              aspectRatio={videoConfigAspectRatio}
              onSceneImageRegenerate={handleSceneImageRegenerate}
              onSceneImageUpload={handleSceneImageUpload}
              onSceneImageExclude={handleSceneImageExclude}
              onSceneImageReorder={handleSceneImageReorder}
              isRegeneratingScene={regenerateScene.isPending ? regenerateScene.variables?.sceneNumber ?? null : null}
            />

            {/* Edit in Studio — opens editor with per-scene clips before assembly */}
            {canEditScenes && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openVideoEditor}
                  className="gap-2"
                >
                  <Film className="h-3.5 w-3.5" />
                  Edit in Studio
                </Button>
              </div>
            )}
          </div>
        );
      
      case 'video_gallery':
        if (isProcessing) {
          return <LoadingState message="Generating video clips..." submessage="AI is creating video from images" />;
        }
        if (isWaiting) {
          return <WaitingState message="Video clips queued" submessage="Waiting for previous stages to complete" />;
        }

        // Check if some clips are still generating (have no video yet)
        const clipsArray = currentStageData.clips || [];
        const clipsStillGenerating = clipsArray.filter((c: any) => !c.video_url && c.status !== 'failed').length;
        const isClipsPartiallyGenerating = clipsStillGenerating > 0 && currentStageData.status === 'generating';

        return (
          <div className="space-y-4">
            {isClipsPartiallyGenerating && (
              <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-primary">
                  Generating clips... {clipsArray.length - clipsStillGenerating}/{clipsArray.length} complete
                </span>
              </div>
            )}
            <StageContentViewer
              stageType="video_gallery"
              stageData={currentStageData}
              outputId={output.id}
              aspectRatio={videoConfigAspectRatio}
              onClipRegenerate={handleClipRegenerate}
              onClipExclude={handleClipExclude}
              isRegeneratingClip={regenerateClip.isPending ? regenerateClip.variables?.sceneNumber ?? null : null}
            />
          </div>
        );
      
      case 'audio':
        if (isProcessing) {
          return <LoadingState message="Generating voiceover..." submessage="AI is creating audio narration" />;
        }
        if (isWaiting) {
          return <WaitingState message="Voiceover queued" submessage="Waiting for previous stages to complete" />;
        }
        // Support both 'url' (legacy TTS) and 'audio_url' (full_voiceover stage)
        const audioUrl = currentStageData.url || currentStageData.audio_url;
        return audioUrl ? (
          <div className="space-y-4">
            {(currentStageData.script_text || currentStageData.script) && (
              <div className="bg-muted/30 rounded-lg p-4">
                <h4 className="text-sm font-medium mb-2">Script Preview</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {(currentStageData.script_text || currentStageData.script || '').substring(0, 500)}
                  {(currentStageData.script_text || currentStageData.script || '').length > 500 ? '...' : ''}
                </p>
              </div>
            )}
            <AudioContentSection
              audioUrl={audioUrl}
              onRegenerate={() => handleRegenerateStage(stage.id)}
              isRegenerating={isApprovalPending}
            />
            {currentStageData.voice_id && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Voice: {currentStageData.voice_id}</span>
                {currentStageData.duration && (
                  <span>Duration: ~{Math.floor(currentStageData.duration / 60)}:{String(Math.round(currentStageData.duration % 60)).padStart(2, '0')}</span>
                )}
                {currentStageData.character_count && (
                  <span>{currentStageData.character_count} characters</span>
                )}
                {currentStageData.word_count && (
                  <span>{currentStageData.word_count} words</span>
                )}
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={Mic}
            title="No audio yet"
            message="Audio narration will appear here once generated"
          />
        );

      case 'audio_gallery':
        if (isProcessing) {
          return <LoadingState message="Generating voice segments..." submessage="AI is creating audio for each scene" />;
        }
        if (isWaiting) {
          return <WaitingState message="Voice segments queued" submessage="Waiting for previous stages to complete" />;
        }

        const voiceSegments = Array.isArray(currentStageData.segments) ? currentStageData.segments : [];
        if (voiceSegments.length === 0) {
          return (
            <EmptyState
              icon={AudioLines}
              title="No voice segments yet"
              message="Voice segments will appear here after generation"
            />
          );
        }

        // Check if some segments are still generating
        const segmentsStillGenerating = voiceSegments.filter((s: any) => !s.audio_url && s.status !== 'failed').length;
        const isSegmentsPartiallyGenerating = segmentsStillGenerating > 0 && currentStageData.status === 'generating';

        return (
          <div className="space-y-4">
            {isSegmentsPartiallyGenerating && (
              <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-primary">
                  Generating voice segments... {voiceSegments.length - segmentsStillGenerating}/{voiceSegments.length} complete
                </span>
              </div>
            )}
            <StageContentViewer
              stageType="audio_gallery"
              stageData={currentStageData}
              outputId={output.id}
              onVoiceSegmentExclude={handleVoiceSegmentExclude}
              onVoiceSegmentRegenerate={handleVoiceSegmentRegenerate}
              isRegeneratingVoiceSegment={regeneratingVoiceSegment}
              onStageApprove={() => handleProceedToNextStage(stage.id)}
              isApprovingStage={isApprovalPending}
              showApproveButton={stageStatuses[stage.id] === 'ready' && stages.findIndex(s => s.id === stage.id) < stages.length - 1}
            />
          </div>
        );

      case 'video':
        if (isProcessing) {
          // If editor_state exists, show instant Player preview while rendering
          const processingEditorState = currentStageData.editor_state as EditorState | undefined;
          if (processingEditorState && processingEditorState.tracks?.length > 0) {
            return (
              <div className="space-y-3">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                  <div>
                    <p className="text-sm font-medium">Rendering in progress...</p>
                    <p className="text-xs text-muted-foreground">Preview available below while video renders on server</p>
                  </div>
                </div>
                <Suspense fallback={<LoadingState message="Loading preview..." />}>
                  <div className="rounded-lg overflow-hidden border border-border bg-black" style={{ aspectRatio: `${processingEditorState.width}/${processingEditorState.height}` }}>
                    <Player
                      acknowledgeRemotionLicense
                      component={EditorCompositionPreview as any}
                      inputProps={processingEditorState}
                      durationInFrames={Math.max(1, processingEditorState.durationInFrames)}
                      fps={processingEditorState.fps}
                      compositionWidth={processingEditorState.width}
                      compositionHeight={processingEditorState.height}
                      style={{ width: '100%', height: '100%' }}
                      controls
                      autoPlay={false}
                      loop
                    />
                  </div>
                </Suspense>
              </div>
            );
          }

          const renderMsg = currentStageData.render_status === 'rendering'
            ? 'Rendering video with Remotion...'
            : 'Assembling final video...';
          const renderSub = currentStageData.scene_count
            ? `${currentStageData.scene_count} scenes, ~${Math.round(currentStageData.total_duration_seconds || 0)}s — this may take several minutes`
            : 'Stitching clips together with audio';
          return <LoadingState message={renderMsg} submessage={renderSub} />;
        }
        
        // For final assembly stage, use retry assembly instead of regenerate
        const isFinalStage = stage.id === stages[stages.length - 1]?.id;
        
        // Check if clips are approved and ready for assembly
        const clipsStageData = stageData['clips'] || {};
        const clipsApproved = clipsStageData.status === 'approved' && (clipsStageData.clips || []).length > 0;
        
        // If waiting but clips are approved, show action button inside the stage (consistent with other stages)
        if (isWaiting && isFinalStage && clipsApproved) {
          return (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                <p className="text-sm font-medium mb-1">Ready for Assembly</p>
                <p className="text-sm text-muted-foreground">
                  All clips are approved and ready for final video assembly.
                </p>
              </div>
              <div className="flex gap-2 pt-2 border-t">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleTriggerAssembly}
                  disabled={isAssemblyPending}
                >
                  {isAssemblyPending ? (
                    <>
                      <RotateCcw className="h-4 w-4 mr-2 animate-spin" />
                      Starting Assembly...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Start Final Assembly
                    </>
                  )}
                </Button>
              </div>
            </div>
          );
        }
        
        if (isWaiting) {
          return <WaitingState message="Video assembly queued" submessage="Waiting for previous stages to complete" />;
        }

        // Video is complete - show video first, then publish button below
        const videoUrl = currentStageData.url || currentStageData.video_url;
        if (videoUrl && isFinalStage) {
          // Check for EditorState from track-based composition
          const completedEditorState = (stageData['composition'] || stageData['final'] || stageData['video'])?.editor_state as EditorState | undefined;
          const hasEditorState = completedEditorState && completedEditorState.tracks?.length > 0;

          return (
            <div className="space-y-4">
              {/* Remotion Player preview — always visible when editor_state exists */}
              {hasEditorState && (
                <Suspense fallback={<LoadingState message="Loading preview..." />}>
                  <div className="rounded-lg overflow-hidden border border-border bg-black" style={{ aspectRatio: `${completedEditorState.width}/${completedEditorState.height}` }}>
                    <Player
                      acknowledgeRemotionLicense
                      component={EditorCompositionPreview as any}
                      inputProps={completedEditorState}
                      durationInFrames={Math.max(1, completedEditorState.durationInFrames)}
                      fps={completedEditorState.fps}
                      compositionWidth={completedEditorState.width}
                      compositionHeight={completedEditorState.height}
                      style={{ width: '100%', height: '100%' }}
                      controls
                      autoPlay={false}
                      loop
                    />
                  </div>
                </Suspense>
              )}

              {/* Edit in Studio CTA — prominent when editor available */}
              <div className="flex justify-center">
                <Button
                  variant={hasEditorState ? "cta" : "outline"}
                  size={hasEditorState ? "default" : "sm"}
                  onClick={openVideoEditor}
                  className="gap-2"
                >
                  <Film className="h-4 w-4" />
                  Edit in Studio
                </Button>
              </div>

              {/* Rendered MP4 — collapsible when Player preview is shown */}
              {hasEditorState ? (
                <details className="border rounded-lg">
                  <summary className="p-3 text-sm font-medium cursor-pointer select-none text-muted-foreground hover:text-foreground">
                    View rendered MP4
                  </summary>
                  <div className="px-3 pb-3">
                    <VideoContentSection
                      videoUrl={videoUrl}
                      onRegenerate={handleRetryAssembly}
                      isRegenerating={isRetryAssemblyPending}
                    />
                  </div>
                </details>
              ) : (
                <VideoContentSection
                  videoUrl={videoUrl}
                  onRegenerate={handleRetryAssembly}
                  isRegenerating={isRetryAssemblyPending}
                />
              )}

              {/* Caption preview if exists */}
              {currentStageData.caption && (
                <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Caption</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setShowPublishDialog(true)}
                    >
                      Edit
                    </Button>
                  </div>
                  <p className="text-sm line-clamp-3">{currentStageData.caption}</p>
                </div>
              )}

              {/* Subtitle editor — only for pipelines that don't burn captions via Remotion */}
              {!['storyboard_video_longform', 'presenter_video'].includes(output.pipeline) && (
                <SubtitleEditor
                  outputId={output.id}
                  transcription={stageData.subtitle_transcription}
                  render={stageData.subtitle_render}
                  defaultTemplateId={output.generation_params?.subtitle_template}
                  originalVideoUrl={stageData.final?.original_video_url}
                />
              )}

            </div>
          );
        }

        return videoUrl ? (
          <VideoContentSection
            videoUrl={videoUrl}
            onRegenerate={isFinalStage ? handleRetryAssembly : () => handleRegenerateStage(stage.id)}
            isRegenerating={isFinalStage ? isRetryAssemblyPending : isApprovalPending}
          />
        ) : currentStageData.error_message || output.error_message ? (
          <div className="space-y-4">
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <p className="text-sm text-destructive font-medium mb-2">Assembly Failed</p>
              <p className="text-sm text-muted-foreground">{currentStageData.error_message || output.error_message}</p>
            </div>
            {isFinalStage && (
              <Button
                variant="outline"
                onClick={handleRetryAssembly}
                disabled={isRetryAssemblyPending}
                className="w-full"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {isRetryAssemblyPending ? "Retrying Assembly..." : "Retry Assembly"}
              </Button>
            )}
          </div>
        ) : (
          <EmptyState
            icon={Video}
            title="No video yet"
            message="The final video will appear here once assembled"
          />
        );

      case 'carousel_style':
        if (isProcessing) {
          return <LoadingState message="Loading style configuration..." submessage="Setting up carousel theme" />;
        }
        if (isWaiting) {
          return <WaitingState message="Style configuration queued" submessage="Waiting to initialize" />;
        }

        // Fallback to generation_params.carousel_style if stage_data not yet populated (brand visual data)
        const styleConfig = currentStageData.style || output.generation_params?.carousel_style;
        if (!styleConfig) {
          return (
            <EmptyState
              icon={Settings}
              title="No style configuration yet"
              message="Carousel style settings will appear here once initialized"
            />
          );
        }

        return (
          <CarouselStyleEditor
            value={styleConfig}
            onChange={handleCarouselStyleChange}
            isReadOnly={false}
          />
        );

      case 'carousel_gallery':
        if (isProcessing) {
          return <LoadingState message="Generating carousel slides..." submessage="AI is creating images for each slide" />;
        }
        if (isWaiting) {
          return <WaitingState message="Carousel slides queued" submessage="Waiting for previous stages to complete" />;
        }

        const carouselSlides = currentStageData.slides;
        if (!carouselSlides || carouselSlides.length === 0) {
          return (
            <EmptyState
              icon={Layers}
              title="No carousel slides yet"
              message="Carousel slides will appear here after generation"
            />
          );
        }

        // Check if some slides are still generating (have no image yet)
        const slidesStillGenerating = carouselSlides.filter((s: any) => !s.image_url && s.status !== 'failed').length;
        const isPartiallyGenerating = slidesStillGenerating > 0 && currentStageData.status === 'generating';

        return (
          <div className="space-y-4">
            {isPartiallyGenerating && (
              <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm text-primary">
                  Generating images... {carouselSlides.length - slidesStillGenerating}/{carouselSlides.length} complete
                </span>
              </div>
            )}
            <CarouselSlideGrid
              slides={carouselSlides}
              aspectRatio={output.generation_params?.output_config?.aspectRatio || output.generation_params?.carousel_style?.aspectRatio || 'square'}
              onSlideApprove={handleCarouselSlideApprove}
              onSlideReject={handleCarouselSlideReject}
              onSlideRegenerate={handleCarouselSlideRegenerate}
              onSlideUpload={handleCarouselSlideUpload}
              onSlideContentEdit={handleCarouselSlideContentEdit}
              contentSlides={stageData.carousel_content?.slides || stageData.carousel_content?.scenes}
              onReorder={handleCarouselSlideReorder}
              isRegeneratingSlide={regeneratingCarouselSlide}
            />
          </div>
        );

      default:
        return <p className="text-sm text-muted-foreground italic">Unknown content type</p>;
    }
  };

  return (
    <div className="h-full flex flex-col overflow-x-hidden">
      {/* Minimal Header */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b bg-background/50">
        <div className="flex items-center justify-between gap-3">
          {/* Left: Title + metadata */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <EditableOutputTitle
                  outputId={output.id}
                  currentTitle={data.title}
                  fallbackTitle={title}
                  jobId={jobId}
                />
                <PublishedPlatformsBadge outputId={output.id} variant="compact" />
              </div>
              {metadataLabel && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground mt-0.5 inline-block">
                  {metadataLabel}
                </span>
              )}
            </div>
          </div>

          {/* Right: Navigation */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={onPrevious}
              disabled={currentIndex === 0}
              className="h-7 w-7"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>

            <span className="text-[11px] text-muted-foreground tabular-nums px-1">
              {currentIndex + 1}/{totalCount}
            </span>

            <Button
              variant="ghost"
              size="icon"
              onClick={onNext}
              disabled={currentIndex === totalCount - 1}
              className="h-7 w-7"
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Stage Progress - Clean horizontal stepper */}
      <div className="flex-shrink-0 px-4 py-2 border-b">
        <CompactStageProgress
          stages={stages}
          currentStage={output.current_stage || activeStageTab}
          stageStatuses={stageStatuses}
        />
      </div>

      {/* Generation Prompts - Collapsible section */}
      {(() => {
        // Image prompt can be in stage_data (social_media_post) or generation_params
        const imagePromptValue = stageData.image_prompt?.content || params?.image_prompt;
        const masterPromptValue = params?.prompt;

        if (!masterPromptValue && !imagePromptValue) return null;

        return (
          <div className="flex-shrink-0 border-b">
            <PromptSection
              masterPrompt={masterPromptValue}
              imagePrompt={imagePromptValue}
              onUpdateMasterPrompt={handleUpdateMasterPrompt}
              onUpdateImagePrompt={handleUpdateImagePrompt}
              isEditable={true}
            />
          </div>
        );
      })()}

      {/* Inline EditorStudio for video pipelines — always visible, chat shows stage progress */}
      {showInlineEditor && (
        <div className="flex-1 min-h-0">
          <Suspense fallback={<LoadingState message="Loading editor..." submessage="Preparing video editor" />}>
            <EditorStudio
              initialState={effectiveEditorState ?? createDefaultEditorState()}
              liveEditorState={hasEffectiveEditorState ? effectiveEditorState : null}
              stageProgress={stages.map(s => ({
                stageId: s.id,
                label: s.label,
                status: stageStatuses[s.id] || 'pending',
              }))}
              autoOpenChat={!hasEditorState}
              stageData={stageData}
              generationParams={params}
              embedded
              onViewStages={() => setForceTabView(true)}
              onViewStage={(stageId) => {
                setActiveStageTab(stageId);
                setForceTabView(true);
              }}
              onExpandFullscreen={openVideoEditor}
              onSave={async (state) => {
                try {
                  const stageKey = stageData['composition'] ? 'composition' : stageData['final'] ? 'final' : 'video';
                  const updatedStageData = {
                    ...stageData,
                    [stageKey]: {
                      ...stageData[stageKey],
                      editor_state: state,
                    },
                  };
                  const { error } = await supabase
                    .from('content_outputs')
                    .update({ stage_data: updatedStageData })
                    .eq('id', output.id);
                  if (error) throw error;
                  queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
                } catch (err: any) {
                  console.error('Failed to save editor state:', err);
                  toast.error('Failed to save editor state');
                }
              }}
              onRender={async (state) => {
                try {
                  const workerUrl = import.meta.env.VITE_VIDEO_RENDERER_WORKER_URL;
                  if (!workerUrl) throw new Error('Video renderer worker URL not configured');
                  const res = await fetch(`${workerUrl}/render`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      composition_id: 'EditorComposition',
                      props: state,
                      output_id: output.id,
                    }),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  toast.success('Render started — video will appear when complete');
                } catch (err: any) {
                  console.error('Failed to start render:', err);
                  toast.error(err.message || 'Failed to start render');
                }
              }}
              onClose={() => {}}
            />
          </Suspense>
        </div>
      )}

      {/* Stage tabs view (default for non-video pipelines, or when user clicks "View Stages") */}
      {!showInlineEditor && (
      <>
      {/* Back to Editor banner when in forced tab view */}
      {isVideoPipeline && forceTabView && (
        <div className="flex-shrink-0 px-4 py-2 border-b bg-muted/20 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Viewing pipeline stages</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-3 text-xs gap-1.5"
            onClick={() => setForceTabView(false)}
          >
            <Film className="h-3 w-3" />
            Back to Editor
          </Button>
        </div>
      )}

      {/* Tabs Navigation */}
      <Tabs value={activeStageTab} onValueChange={setActiveStageTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-4 border-b">
          <TabsList className="h-10 bg-transparent p-0 gap-2">
            {stages.map((stage) => (
              <StageTab
                key={stage.id}
                stageId={stage.id}
                label={stage.label}
                status={stageStatuses[stage.id] || 'pending'}
              />
            ))}
          </TabsList>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {stages.map((stage) => {
            const stageStatus = stageStatuses[stage.id] || 'pending';
            const isReady = stageStatus === 'ready';
            const isGenerating = stageStatus === 'generating';
            const isFailed = stageStatus === 'failed';

            return (
              <TabsContent
                key={stage.id}
                value={stage.id}
                className="m-0 h-full data-[state=inactive]:hidden"
              >
                <div className="p-4 space-y-4">
                  {/* Stage Status Header */}
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium">{stage.label}</h3>
                    {isFailed && (
                      <span className="text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                        Failed
                      </span>
                    )}
                    {isGenerating && (
                      <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                        Generating
                      </span>
                    )}
                    {isReady && (
                      <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                        Ready
                      </span>
                    )}
                  </div>

                  {/* Stage Content */}
                  {renderStageContent(stage)}

                  {/* Stage Metadata */}
                  <StageMetadata stageData={stageData[stage.id]} />
                </div>
              </TabsContent>
            );
          })}
        </div>
      </Tabs>

      {/* Footer with actions */}
      <div className="flex-shrink-0 px-4 py-2 border-t bg-muted/30">
        <div className="flex items-center justify-between">
          {/* Left: Secondary actions */}
          <div className="flex items-center gap-1">
            {onCopy && (
              <Button variant="ghost" size="sm" className="h-7 w-7 px-0" onClick={onCopy}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0 text-muted-foreground hover:text-primary"
              onClick={handleSaveToLibrary}
              title="Save to Library"
            >
              <Bookmark className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Right: Stage approval actions or Publish button */}
          <div className="flex items-center gap-2">
            {/* Stage action buttons - Regenerate and Proceed to Next Stage */}
            {(() => {
              const activeStage = stages.find(s => s.id === activeStageTab);
              const activeStageStatus = stageStatuses[activeStageTab];
              const isVideoPipeline = ['generative_video_oneshot', 'ugc_video', 'storyboard_video_longform', 'presenter_video', 'video'].includes(output.pipeline);
              // Check for final video - pipelines use 'final', 'video', or 'composition' as stage id
              const isFinalVideoStage = (activeStage?.id === 'final' || activeStage?.id === 'video' || activeStage?.id === 'composition') && activeStage?.type === 'video';
              const hasFinalVideoUrl = stageData.final?.url || stageData.final?.video_url || stageData.video?.url || stageData.video?.video_url || stageData.composition?.url || stageData.composition?.video_url;
              const isFinalStageWithVideo = isFinalVideoStage && hasFinalVideoUrl;

              // Show regenerate button for ready stages
              const showRegenerateButton = activeStage?.approvable &&
                (!isFinalVideoStage || (isVideoPipeline && isFinalStageWithVideo)) &&
                (activeStageStatus === 'ready' || activeStageStatus === 'failed');

              // Show proceed button when stage is ready and there's a next stage
              // Never show on the last stage (index === stages.length - 1)
              const currentStageIndex = stages.findIndex(s => s.id === activeStageTab);
              const isLastStage = currentStageIndex === stages.length - 1;
              const hasNextStage = currentStageIndex >= 0 && !isLastStage;
              const showProceedButton = activeStageStatus === 'ready' && hasNextStage;

              return (
                <>
                  {showRegenerateButton && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 text-xs"
                      onClick={() => handleRegenerateStage(activeStageTab)}
                      disabled={loadingStages[activeStageTab] || isApprovalPending}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      {loadingStages[activeStageTab] || isApprovalPending ? 'Regenerating...' : 'Regenerate'}
                    </Button>
                  )}
                  {showProceedButton && (
                    <Button
                      size="sm"
                      variant="cta"
                      className="h-7 px-3 text-xs"
                      onClick={() => handleProceedToNextStage(activeStageTab)}
                      disabled={isApprovalPending}
                    >
                      {isApprovalPending ? 'Processing...' : 'Proceed to Next Stage'}
                      <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                    </Button>
                  )}
                </>
              );
            })()}

            {/* Publish button for social_media_post (show as soon as caption exists - allows manual image upload) */}
            {output.pipeline === 'social_media_post' && (stageData.caption?.status === 'approved' || stageData.caption?.status === 'ready' || !!stageData.caption?.content) && (
              <Button
                size="sm"
                className="h-7 bg-gradient-aca"
                onClick={() => setShowPublishDialog(true)}
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Publish
              </Button>
            )}

            {/* Publish button for instagram_carousel (show when carousel slides have images) */}
            {(output.pipeline === 'instagram_carousel' || output.pipeline === 'instagram_carousel_ai') && (() => {
              const carouselSlides = stageData.carousel_slides?.slides || [];
              const slidesWithImages = carouselSlides.filter((s: any) => s.image_url);
              // Show button if at least one slide has an image (approved or not)
              if (slidesWithImages.length === 0) return null;
              return (
                <Button
                  size="sm"
                  className="h-7 bg-gradient-aca"
                  onClick={() => setShowPublishDialog(true)}
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Publish
                </Button>
              );
            })()}

            {/* Publish button for video pipelines (show when final video is complete) */}
            {(() => {
              const isVideoPipeline = ['generative_video_oneshot', 'ugc_video', 'storyboard_video_longform', 'presenter_video', 'video'].includes(output.pipeline);
              // Pipelines use 'final', 'video', or 'composition' as stage id
              const finalVideoUrl = stageData.final?.url || stageData.final?.video_url || stageData.video?.url || stageData.video?.video_url || stageData.composition?.url || stageData.composition?.video_url;

              if (!isVideoPipeline || !finalVideoUrl) return null;

              return (
                <Button
                  size="sm"
                  className="h-7 bg-gradient-aca"
                  onClick={() => setShowPublishDialog(true)}
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Publish
                </Button>
              );
            })()}
          </div>
        </div>
      </div>
      </>
      )}

      {/* Publish Dialog */}
      <PushToGHLDialog
        key={output.id}
        open={showPublishDialog}
        onOpenChange={setShowPublishDialog}
        outputId={output.id}
        outputTitle={title}
        outputData={output}
      />

      {/* Save to Library Dialog */}
      <SaveContentMultiDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        availableContent={getAvailableContentForSave()}
        sourceOutputId={output.id}
        sourceJobId={output.job_id}
        outputTitle={title}
      />

      {/* Fullscreen Video Editor Dialog */}
      <dialog
        ref={videoEditorDialogRef}
        className="fixed inset-0 w-full h-full max-w-none max-h-none m-0 p-0 bg-background border-none outline-none backdrop:bg-black/50"
        style={{ width: '100vw', height: '100vh' }}
      >
        {showVideoEditor && (
          <div className="h-full w-full overflow-hidden">
          <Suspense fallback={<LoadingState message="Loading editor..." submessage="Preparing Remotion video editor" />}>
            <EditorStudio
              initialState={effectiveEditorState ?? createDefaultEditorState()}
              liveEditorState={hasEffectiveEditorState ? effectiveEditorState : null}
              stageProgress={stages.map(s => ({
                stageId: s.id,
                label: s.label,
                status: stageStatuses[s.id] || 'pending',
              }))}
              autoOpenChat={!hasEditorState}
              stageData={stageData}
              generationParams={params}
              onSave={async (state) => {
                try {
                  const stageKey = stageData['composition'] ? 'composition' : stageData['final'] ? 'final' : 'video';
                  const updatedStageData = {
                    ...stageData,
                    [stageKey]: {
                      ...stageData[stageKey],
                      editor_state: state,
                    },
                  };
                  const { error } = await supabase
                    .from('content_outputs')
                    .update({ stage_data: updatedStageData })
                    .eq('id', output.id);
                  if (error) throw error;
                  queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
                } catch (err: any) {
                  console.error('Failed to save editor state:', err);
                  toast.error('Failed to save editor state');
                }
              }}
              onRender={async (state) => {
                try {
                  const workerUrl = import.meta.env.VITE_VIDEO_RENDERER_WORKER_URL;
                  if (!workerUrl) throw new Error('Video renderer worker URL not configured');
                  const res = await fetch(`${workerUrl}/render`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      composition_id: 'EditorComposition',
                      props: state,
                      output_id: output.id,
                    }),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  toast.success('Render started — video will appear when complete');
                } catch (err: any) {
                  console.error('Failed to start render:', err);
                  toast.error(err.message || 'Failed to start render');
                }
              }}
              onClose={closeVideoEditor}
            />
          </Suspense>
          </div>
        )}
      </dialog>
    </div>
  );
}
