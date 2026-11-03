import { Blueprint } from "@/types/blueprint";
import { VideoConfig, OutputConfig } from "@/types/wizard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VideoConfigPanel } from "@/components/assembler/wizard/VideoConfigPanel";
import { OutputConfigPanel } from "@/components/assembler/wizard/OutputConfigPanel";
import { PresenterVideoConfig, type PresenterVideoConfigValues } from "@/components/presenter/PresenterVideoConfig";
import { VideoRemixConfig, type VideoRemixConfigValues } from "@/components/remix/VideoRemixConfig";
import { UnifiedVideoConfig } from "@/components/video/UnifiedVideoConfig";
import type { VideoConfig as UnifiedVideoConfigType } from "@/types/video";
import { DEFAULT_VIDEO_CONFIG } from "@/types/video";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useMemo, useEffect, useCallback } from "react";
import { Settings2, CheckCircle2 } from "lucide-react";
import { formatLabel } from "@/lib/blueprintCardUtils";
import {
  isVideoPipeline,
  isVisualPipeline,
  isLongformVideoPipeline,
} from "@/lib/pipelineUtils";
import { useCharacters } from "@/hooks/useCharacters";
import { useAuth } from "@/contexts/AuthContext";

interface ConfigurationStepProps {
  blueprint: Blueprint;
  videoConfig: VideoConfig | null;
  onVideoConfigChange: (config: VideoConfig) => void;
  outputConfig: OutputConfig | null;
  onOutputConfigChange: (config: OutputConfig) => void;
  presenterConfig: PresenterVideoConfigValues | null;
  onPresenterConfigChange: (config: PresenterVideoConfigValues | null) => void;
  remixConfig: VideoRemixConfigValues | null;
  onRemixConfigChange: (config: VideoRemixConfigValues | null) => void;
  unifiedVideoConfig: UnifiedVideoConfigType | null;
  onUnifiedVideoConfigChange: (config: UnifiedVideoConfigType | null) => void;
  recordingMode?: boolean;
}

const DEFAULT_PRESENTER_CONFIG: PresenterVideoConfigValues = {
  voiceType: 'voiceover',
  bRollEnabled: false,
  bRollStyle: 'stock',
  subtitleStyle: 'tiktok_bounce',
  orientation: 'portrait',
};

const DEFAULT_REMIX_CONFIG: VideoRemixConfigValues = {
  visualStyle: 'enhance',
  voiceOption: 'new_voice',
  voiceId: '',
  avatarType: 'none',
  lipSyncProvider: 'elevenlabs',
  bRollEnabled: false,
  bRollStyle: 'stock',
  subtitleStyle: 'tiktok_bounce',
  orientation: 'portrait',
  templateType: 'product_review',
  maxFrames: 12,
};

export function ConfigurationStep({
  blueprint,
  videoConfig,
  onVideoConfigChange,
  outputConfig,
  onOutputConfigChange,
  presenterConfig,
  onPresenterConfigChange,
  remixConfig,
  onRemixConfigChange,
  unifiedVideoConfig,
  onUnifiedVideoConfigChange,
  recordingMode,
}: ConfigurationStepProps) {
  const { currentOrganization } = useAuth();
  const isPresenterVideo = blueprint.pipeline === 'presenter_video';
  const isVideoRemix = blueprint.pipeline === 'video_remix';
  const isUnifiedVideo = blueprint.pipeline === 'video';
  const showVideoPipeline = isVideoPipeline(blueprint.pipeline) && !isPresenterVideo && !isVideoRemix && !isUnifiedVideo;
  const showVisualPipeline = isVisualPipeline(blueprint.pipeline);
  const isLongform = isLongformVideoPipeline(blueprint.pipeline);

  // Fetch characters for video_remix avatar selection
  const { data: characters } = useCharacters();

  // Handle recorder completion — store EditorState for later use
  const handleRecordingComplete = useCallback((state: import('@/lib/editorState').EditorState) => {
    // TODO: In future, this could navigate to EditorStudio directly
    // For now, store a marker so the pipeline knows to skip capture stages
    console.log('[ConfigurationStep] Recording complete, EditorState received:', state.tracks.length, 'tracks');
  }, []);

  // Default video config - memoized to prevent object recreation
  const defaultVideoConfig: VideoConfig = useMemo(
    () =>
      isLongform
        ? {
            totalDuration: 300, // 5 minutes
            aspectRatio: 'landscape' as const,
          }
        : {
            totalDuration: 60,
            aspectRatio: 'landscape' as const,
          },
    [isLongform]
  );

  // Default output config - memoized to prevent object recreation
  const defaultOutputConfig: OutputConfig = useMemo(
    () =>
      blueprint.pipeline === 'instagram_carousel'
        ? { aspectRatio: 'square' as const }
        : { aspectRatio: 'landscape' as const },
    [blueprint.pipeline]
  );

  // Auto-initialize video config if not set
  useEffect(() => {
    if (showVideoPipeline && !videoConfig) {
      onVideoConfigChange(defaultVideoConfig);
    }
  }, [showVideoPipeline, videoConfig, defaultVideoConfig, onVideoConfigChange]);

  // Auto-initialize output config if not set
  useEffect(() => {
    if (showVisualPipeline && !outputConfig) {
      onOutputConfigChange(defaultOutputConfig);
    }
  }, [showVisualPipeline, outputConfig, defaultOutputConfig, onOutputConfigChange]);

  // Auto-initialize presenter config if not set
  useEffect(() => {
    if (isPresenterVideo && !presenterConfig) {
      onPresenterConfigChange(DEFAULT_PRESENTER_CONFIG);
    }
  }, [isPresenterVideo, presenterConfig, onPresenterConfigChange]);

  // Auto-initialize remix config if not set
  useEffect(() => {
    if (isVideoRemix && !remixConfig) {
      onRemixConfigChange(DEFAULT_REMIX_CONFIG);
    }
  }, [isVideoRemix, remixConfig, onRemixConfigChange]);

  // Unified video config is now auto-initialized in useWizardState when blueprint is selected.
  // This step only shows when blueprint lacks a source default, so config is always ready.

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
          <Settings2 className="h-8 w-8 text-cta" />
          {recordingMode ? 'Record' : 'Configure Output'}
        </h1>
        <p className="text-muted-foreground text-lg">
          {recordingMode ? 'Record your screen and configure output settings.' : 'Set the format and dimensions for your content.'}
        </p>
      </div>

      {/* Selected Blueprint Summary */}
      <Card className="border-cta/20 bg-cta/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-cta" />
              <div>
                <CardTitle className="text-lg">{blueprint.name}</CardTitle>
                {blueprint.description && (
                  <CardDescription className="mt-1">
                    {blueprint.description}
                  </CardDescription>
                )}
              </div>
            </div>
            {blueprint.pipeline && (
              <Badge variant="secondary">
                {formatLabel(blueprint.pipeline)}
              </Badge>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Presenter Video Configuration */}
      {isPresenterVideo && (
        <ErrorBoundary>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Presenter Video Settings</CardTitle>
              <CardDescription>
                Choose your visual source, voice style, and creative direction
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PresenterVideoConfig
                value={presenterConfig || DEFAULT_PRESENTER_CONFIG}
                onChange={onPresenterConfigChange}
              />
            </CardContent>
          </Card>
        </ErrorBoundary>
      )}

      {/* Video Remix Configuration */}
      {isVideoRemix && (
        <ErrorBoundary>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Video Remix Settings</CardTitle>
              <CardDescription>
                Upload a video, choose rewrite style, voice, and visual options
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VideoRemixConfig
                value={remixConfig || DEFAULT_REMIX_CONFIG}
                onChange={onRemixConfigChange}
                characters={characters?.map(c => ({
                  id: c.id,
                  name: c.name,
                  avatar_url: c.avatar_url,
                })) || []}
              />
            </CardContent>
          </Card>
        </ErrorBoundary>
      )}

      {/* Unified Video Configuration */}
      {isUnifiedVideo && (
        <ErrorBoundary>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{recordingMode ? 'Recording Settings' : 'Video Settings'}</CardTitle>
              <CardDescription>
                {recordingMode
                  ? 'Record your screen and set output preferences'
                  : 'Configure source, narration, voice, and visual style for your video'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UnifiedVideoConfig
                value={unifiedVideoConfig || DEFAULT_VIDEO_CONFIG}
                onChange={onUnifiedVideoConfigChange}
                onRecordingComplete={handleRecordingComplete}
                autoOpenRecorder={recordingMode}
              />
            </CardContent>
          </Card>
        </ErrorBoundary>
      )}

      {/* Video Configuration Panel */}
      {showVideoPipeline && (
        <ErrorBoundary>
          <VideoConfigPanel
            config={videoConfig || defaultVideoConfig}
            onChange={onVideoConfigChange}
            isLongform={isLongform}
          />
        </ErrorBoundary>
      )}

      {/* Output Configuration Panel */}
      {showVisualPipeline && (
        <ErrorBoundary>
          <OutputConfigPanel
            config={outputConfig || defaultOutputConfig}
            onChange={onOutputConfigChange}
            pipeline={blueprint.pipeline}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
