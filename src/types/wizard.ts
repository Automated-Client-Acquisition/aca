import { Blueprint, PinnedLibraryElements } from "./blueprint";
import { ManualIdeaRow } from "./generation";
import type { VideoConfig as UnifiedVideoConfig } from "./video";
import type { RecordingMetadata } from "@/contexts/RecorderContext";
// Legacy imports kept for backwards compatibility with existing wizard state consumers
import type { PresenterVideoConfigValues } from "@/components/presenter/PresenterVideoConfig";
import type { VideoRemixConfigValues } from "@/components/remix/VideoRemixConfig";

export type WizardStepType = 'blueprint' | 'configuration' | 'ideas' | 'library' | 'review';

// AI Insights configuration for generation
// Users can select which insights to include and optionally create variations
export interface SelectedAiInsights {
  // Hooks configuration
  createVariations: boolean; // When true, use hooks based on hookMode
  selectedHookIndices: number[];
  hookMode?: 'combine' | 'separate'; // 'combine' = all hooks in one output, 'separate' = one output per hook

  // Talking Points configuration
  includeTalkingPoints: boolean;
  createTalkingPointVariations: boolean;
  selectedTalkingPointIndices: number[];
  talkingPointMode?: 'combine' | 'separate';

  // CTAs configuration
  includeCta: boolean;
  selectedCtaIndices?: number[]; // Multiple CTAs can be selected now
  ctaMode?: 'combine' | 'separate'; // 'combine' = all CTAs in one output, 'separate' = one output per CTA
  selectedCtaIndex: number | null; // Legacy - keep for backwards compatibility

  // Other options
  includeScriptStructure: boolean;
  includeEngagementDrivers: boolean;
}

// Map of idea ID to its selected AI insights
export type IdeaAiInsightsMap = Record<string, SelectedAiInsights | null>;

export interface WizardStep {
  id: string;
  type: WizardStepType;
  title: string;
  description: string;
  libraryTable?: string; // For library steps
  isComplete: boolean;
  isRequired: boolean;
}

// Aspect ratio options for all visual content
export type AspectRatio = 'landscape' | 'portrait' | 'square';

// Mapping of aspect ratio values to actual dimensions for display
export const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, string> = {
  landscape: '16:9',
  portrait: '9:16',
  square: '1:1',
};

export interface VideoConfig {
  totalDuration: number;
  aspectRatio: AspectRatio;
}

// Output configuration for non-video visual pipelines
export interface OutputConfig {
  aspectRatio: AspectRatio;
  // Carousel settings moved to blueprint model_config (carousel_template, carousel_slide_count)
  // These are kept here for backwards compat — ReviewStep merges blueprint values in
  slideCount?: number;
  carouselTemplate?: string;
  customPalette?: {
    primary?: string;
    secondary?: string;
    background?: string;
    text?: string;
    accent?: string;
  };
  backgroundImageUrl?: string;
}

export interface WizardState {
  currentStepIndex: number;
  steps: WizardStep[];
  blueprint: Blueprint | null;
  ideaRows: ManualIdeaRow[];
  pinnedLibraryElements: PinnedLibraryElements;
  customPrompt: string | null;
  customImagePrompt: string | null; // Custom image prompt override for this generation run
  hasConfirmedReview: boolean;
  videoConfig: VideoConfig | null;
  outputConfig: OutputConfig | null; // For non-video visual pipelines
  presenterConfig: PresenterVideoConfigValues | null; // Legacy: presenter_video pipeline
  remixConfig: VideoRemixConfigValues | null; // Legacy: video_remix pipeline
  unifiedVideoConfig: UnifiedVideoConfig | null; // For unified 'video' pipeline
  ideaAiInsights: IdeaAiInsightsMap; // AI insights selected per idea
  autoApproveAll: boolean; // Auto-approve all pipeline stages without manual review
  isRecordingMode: boolean; // Streamlined wizard for screen recording flow
  preRecordedEditorState: RecordingMetadata | null; // EditorState from recorder overlay
}

export interface WizardActions {
  goToStep: (index: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setBlueprint: (blueprint: Blueprint | null) => void;
  setIdeaRows: (rows: ManualIdeaRow[]) => void;
  setPinnedLibraryElements: (elements: PinnedLibraryElements) => void;
  setCustomPrompt: (prompt: string | null) => void;
  setCustomImagePrompt: (prompt: string | null) => void;
  setHasConfirmedReview: (confirmed: boolean) => void;
  setVideoConfig: (config: VideoConfig | null) => void;
  setOutputConfig: (config: OutputConfig | null) => void;
  setPresenterConfig: (config: PresenterVideoConfigValues | null) => void;
  setRemixConfig: (config: VideoRemixConfigValues | null) => void;
  setUnifiedVideoConfig: (config: UnifiedVideoConfig | null) => void;
  setIdeaAiInsights: (insights: IdeaAiInsightsMap) => void;
  updateIdeaAiInsights: (ideaId: string, insights: SelectedAiInsights | null) => void;
  setAutoApproveAll: (enabled: boolean) => void;
  setIsRecordingMode: (mode: boolean) => void;
  setPreRecordedEditorState: (state: RecordingMetadata | null) => void;
  canProceed: () => boolean;
  reset: () => void;
}
