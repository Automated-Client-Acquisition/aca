import { TextContentSection } from "./TextContentSection";
import { ImageContentSection } from "./ImageContentSection";
import { AudioContentSection } from "./AudioContentSection";
import { VideoContentSection } from "./VideoContentSection";
import { ScenePromptsViewer } from "./ScenePromptsViewer";
import { SceneImageGrid } from "./SceneImageGrid";
import { SceneClipGrid } from "./SceneClipGrid";
import { CarouselSlideGrid } from "./CarouselSlideGrid";
import { VoiceSegmentsViewer } from "./VoiceSegmentsViewer";
import { EmptyState } from "./EmptyState";
import { FileText, Image, Images, Mic, Video, Film, Layers, AudioLines, ScrollText } from "lucide-react";
import type { CarouselStyleConfig } from "@/types/carousel";

interface StageContentViewerProps {
  stageType: 'text' | 'image' | 'audio' | 'video' | 'text_gallery' | 'image_gallery' | 'video_gallery' | 'script' | 'carousel_gallery' | 'audio_gallery';
  stageData: any;
  outputId?: string;
  aspectRatio?: 'landscape' | 'portrait' | 'square'; // From video_config for proper display
  // Stage-level approval
  onStageApprove?: () => void;
  isApprovingStage?: boolean;
  showApproveButton?: boolean;
  // Scene prompts (text_gallery)
  onScenePromptExclude?: (sceneNumber: number) => void;
  onScenePromptEdit?: (sceneNumber: number, newPrompt: string) => void;
  onScenePromptRegenerate?: (sceneNumber: number) => void;
  onScenePromptRegenerateAll?: () => void;
  // Scene images (image_gallery)
  onSceneImageRegenerate?: (sceneNumber: number, prompt?: string, instructions?: string) => void;
  onSceneImageUpload?: (sceneNumber: number, file: File) => void;
  onSceneImageExclude?: (sceneNumber: number) => void;
  onSceneImageReorder?: (fromIndex: number, toIndex: number) => void;
  isRegeneratingScene?: number | null;
  // Video clips (video_gallery)
  onClipRegenerate?: (sceneNumber: number) => void;
  onClipExclude?: (sceneNumber: number) => void;
  isRegeneratingClip?: number | null;
  // Carousel handlers
  onCarouselStyleChange?: (style: CarouselStyleConfig) => void;
  onCarouselStyleConfirm?: () => void;
  onSlideApprove?: (slideNumber: number) => void;
  onSlideReject?: (slideNumber: number) => void;
  onSlideRegenerate?: (slideNumber: number, prompt?: string, instructions?: string) => void;
  onSlideUpload?: (slideNumber: number, file: File) => void;
  onSlideReorder?: (fromIndex: number, toIndex: number) => void;
  isRegeneratingSlide?: number | null;
  // Voice segments handlers (audio_gallery)
  onVoiceSegmentExclude?: (sceneNumber: number) => void;
  onVoiceSegmentRegenerate?: (sceneNumber: number) => void;
  isRegeneratingVoiceSegment?: number | null;
}

export function StageContentViewer({
  stageType,
  stageData,
  outputId,
  aspectRatio = 'landscape',
  // Stage-level approval
  onStageApprove,
  isApprovingStage = false,
  showApproveButton = false,
  // Scene prompts
  onScenePromptExclude,
  onScenePromptEdit,
  onScenePromptRegenerate,
  onScenePromptRegenerateAll,
  // Scene images
  onSceneImageRegenerate,
  onSceneImageUpload,
  onSceneImageExclude,
  onSceneImageReorder,
  isRegeneratingScene = null,
  // Video clips
  onClipRegenerate,
  onClipExclude,
  isRegeneratingClip = null,
  // Carousel props
  onCarouselStyleChange,
  onCarouselStyleConfirm,
  onSlideApprove,
  onSlideReject,
  onSlideRegenerate,
  onSlideUpload,
  onSlideReorder,
  isRegeneratingSlide = null,
  // Voice segments props
  onVoiceSegmentExclude,
  onVoiceSegmentRegenerate,
  isRegeneratingVoiceSegment = null,
}: StageContentViewerProps) {
  
  switch (stageType) {
    case 'text':
      if (stageData?.content) {
        return <TextContentSection content={stageData.content} />;
      }
      return <EmptyState icon={FileText} title="No content yet" message="Text content will appear here once generated" />;

    case 'text_gallery':
      return (
          <ScenePromptsViewer
            scenePrompts={stageData?.scenes || []}
            onExclude={onScenePromptExclude || (() => {})}
            onEdit={onScenePromptEdit || (() => {})}
            onRegenerate={onScenePromptRegenerate || (() => {})}
            onRegenerateAll={onScenePromptRegenerateAll || (() => {})}
            isRegeneratingScene={null}
          />
      );
    
    case 'image_gallery':
      if (stageData?.scenes && Array.isArray(stageData.scenes)) {
        return (
          <SceneImageGrid
            scenes={stageData.scenes}
            onSceneRegenerate={onSceneImageRegenerate || (() => {})}
            onSceneUpload={onSceneImageUpload || (() => {})}
            onSceneExclude={onSceneImageExclude || (() => {})}
            onReorder={onSceneImageReorder}
            isRegeneratingScene={isRegeneratingScene}
            aspectRatio={aspectRatio}
          />
        );
      }
      return <EmptyState icon={Images} title="No storyboard yet" message="Scene images will appear here after generation" />;

    case 'image':
      if (stageData?.image_url || stageData?.url) {
        return (
          <ImageContentSection
            imageUrl={stageData.image_url || stageData.url}
            imagePrompt={stageData.prompt || stageData.image_prompt || ''}
          />
        );
      }
      return <EmptyState icon={Image} title="No image yet" message="The featured image will appear here once generated" />;

    case 'audio':
      if (stageData?.url || stageData?.audio_url) {
        return (
          <div className="space-y-4">
            {stageData.script_text && (
              <div className="bg-muted/30 rounded-lg p-4">
                <h4 className="text-sm font-medium mb-2">Narration Script</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{stageData.script_text}</p>
              </div>
            )}
            <AudioContentSection audioUrl={stageData.url || stageData.audio_url} />
            {(stageData.voice_id || stageData.duration || stageData.character_count) && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {stageData.voice_id && <span>Voice ID: {stageData.voice_id}</span>}
                {stageData.duration && (
                  <span>Duration: ~{Math.floor(stageData.duration / 60)}:{String(stageData.duration % 60).padStart(2, '0')}</span>
                )}
                {stageData.character_count && (
                  <span>{stageData.character_count.toLocaleString()} characters</span>
                )}
              </div>
            )}
          </div>
        );
      }
      return <EmptyState icon={Mic} title="No audio yet" message="Audio narration will appear here after generation" />;

    case 'video':
      if (stageData?.video_url || stageData?.url) {
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Final Assembled Video</h3>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {stageData?.duration && (
                  <span>Duration: {Math.floor(stageData.duration / 60)}:{String(Math.floor(stageData.duration % 60)).padStart(2, '0')}</span>
                )}
                {stageData?.cost !== undefined && (
                  <span>Cost: ${stageData.cost.toFixed(4)}</span>
                )}
                {stageData?.clips_count && (
                  <span>{stageData.clips_count} clips</span>
                )}
              </div>
            </div>
            <VideoContentSection videoUrl={stageData.video_url || stageData.url} />
          </div>
        );
      }
      return <EmptyState icon={Video} title="No video yet" message="The final video will appear here once assembled" />;

    case 'video_gallery':
      if (stageData?.clips && Array.isArray(stageData.clips) && outputId) {
        return (
          <SceneClipGrid
            clips={stageData.clips}
            onClipRegenerate={onClipRegenerate || (() => {})}
            onClipExclude={onClipExclude || (() => {})}
            isRegeneratingClip={isRegeneratingClip}
            outputId={outputId}
            onStageApprove={onStageApprove}
            isApprovingStage={isApprovingStage}
            showApproveButton={showApproveButton}
          />
        );
      }
      return <EmptyState icon={Film} title="No video clips yet" message="Video clips will appear here after generation" />;

    case 'script':
      // Script is essentially styled text - same as text but potentially with formatting
      if (stageData?.content || stageData?.script) {
        return <TextContentSection content={stageData.content || stageData.script} />;
      }
      return <EmptyState icon={ScrollText} title="No script yet" message="The script will appear here once generated" />;

    case 'carousel_gallery':
      if (stageData?.slides && Array.isArray(stageData.slides)) {
        return (
          <CarouselSlideGrid
            slides={stageData.slides}
            style={stageData.style}
            onSlideApprove={onSlideApprove || (() => {})}
            onSlideReject={onSlideReject || (() => {})}
            onSlideRegenerate={onSlideRegenerate || (() => {})}
            onSlideUpload={onSlideUpload || (() => {})}
            onReorder={onSlideReorder}
            isRegeneratingSlide={isRegeneratingSlide}
          />
        );
      }
      return <EmptyState icon={Layers} title="No slides yet" message="Carousel slides will appear here after generation" />;

    case 'audio_gallery':
      if (stageData?.segments && Array.isArray(stageData.segments)) {
        return (
          <VoiceSegmentsViewer
            segments={stageData.segments}
            totalDuration={stageData.total_duration || 0}
            totalCharacters={stageData.total_characters || 0}
            voiceId={stageData.voice_id || ''}
            onExclude={onVoiceSegmentExclude || (() => {})}
            onRegenerate={onVoiceSegmentRegenerate || (() => {})}
            isRegeneratingSegment={isRegeneratingVoiceSegment}
            onStageApprove={onStageApprove}
            isApprovingStage={isApprovingStage}
            showApproveButton={showApproveButton}
          />
        );
      }
      return <EmptyState icon={AudioLines} title="No voice segments yet" message="Voice segments will appear here after generation" />;

    default:
      return <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto">{JSON.stringify(stageData, null, 2)}</pre>;
  }
}
