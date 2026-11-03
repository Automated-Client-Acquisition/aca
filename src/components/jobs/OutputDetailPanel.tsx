import { useState, useEffect } from "react";
import { SocialMediaLayout } from "./layouts/SocialMediaLayout";
import { ArticleLayout } from "./layouts/ArticleLayout";
import { ScriptLayout } from "./layouts/ScriptLayout";
import { ImageOnlyLayout } from "./layouts/ImageOnlyLayout";
import { MultiStageDetailPanel } from "./MultiStageDetailPanel";
import { useGenerateImage } from "@/hooks/useGenerateImage";
import { useUpdateContentOutput } from "@/hooks/useUpdateContentOutput";
import { useRegenerateContent } from "@/hooks/useRegenerateContent";
import type { PipelineId } from "@/types/pipeline";
import { PIPELINE_STAGES } from "@/types/pipelineStages";

interface OutputDetailPanelProps {
  output: any;
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onCopy?: () => void;
}


export function OutputDetailPanel({
  output,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onApprove,
  onReject,
  onDelete,
  onCopy,
}: OutputDetailPanelProps) {
  const pipeline = output.pipeline as PipelineId;
  const data = output.data || {};
  
  // Check if this is a multi-stage pipeline
  const allStages = PIPELINE_STAGES[pipeline];
  // For video pipeline, filter to only the stages that were resolved at dispatch time
  const resolvedStageIds: string[] | undefined = output.generation_params?.pipeline_stages;
  const stages = (pipeline === 'video' && resolvedStageIds?.length)
    ? allStages?.filter(s => resolvedStageIds.includes(s.id))
    : allStages;
  const isMultiStage = stages && stages.length > 1 && stages.some(s => s.approvable);
  
  // If multi-stage, use MultiStageDetailPanel
  if (isMultiStage) {
    return (
      <MultiStageDetailPanel
        output={output}
        stages={stages}
        currentIndex={currentIndex}
        totalCount={totalCount}
        onPrevious={onPrevious}
        onNext={onNext}
        onDelete={onDelete}
        onCopy={onCopy}
      />
    );
  }
  
  // Shared hooks for all layouts
  const generateImage = useGenerateImage();
  const updateOutput = useUpdateContentOutput();
  const regenerateContent = useRegenerateContent();

  // Bridge the gap between mutation completing and refetched data arriving
  // This prevents the animation from disappearing during the invalidation window
  const [imageGenerationRequested, setImageGenerationRequested] = useState(false);

  // Clear the flag once the server-side status confirms generating (or image changes)
  const stageData = output.stage_data || {};
  useEffect(() => {
    if (imageGenerationRequested) {
      const serverConfirmsGenerating =
        data.image_status === 'generating' ||
        stageData.image?.status === 'generating';
      if (serverConfirmsGenerating) {
        setImageGenerationRequested(false);
      }
    }
  }, [imageGenerationRequested, data.image_status, stageData.image?.status]);

  // Get reference image from generation params if available
  // image_inputs is Record<string, string[]> - get the first image from any category
  const imageInputs = output.generation_params?.image_inputs || {};
  const referenceImage = (Object.values(imageInputs).flat()[0] as string) || null;

  // Shared handlers
  const handleGenerateImage = async (prompt: string) => {
    setImageGenerationRequested(true);
    await generateImage.mutateAsync({
      outputId: output.id,
      prompt,
      referenceImage
    });
  };

  const handleRegenerateImage = async (prompt: string, instructions?: string) => {
    setImageGenerationRequested(true);
    await generateImage.mutateAsync({
      outputId: output.id,
      prompt,
      instructions,
      referenceImage
    });
  };

  const handleUpdateText = async (newText: string) => {
    await updateOutput.mutateAsync({
      id: output.id,
      data: { ...data, text: newText }
    });
  };

  const handleUpdateImage = async (newImageUrl: string | null) => {
    // For image_only pipeline, update stage_data.image.url instead of data.image_url
    if (pipeline === 'image_only') {
      await updateOutput.mutateAsync({
        id: output.id,
        stage_data: {
          ...stageData,
          image: {
            ...stageData.image,
            url: newImageUrl,
            image_url: newImageUrl,
          }
        }
      });
    } else {
      await updateOutput.mutateAsync({
        id: output.id,
        data: { ...data, image_url: newImageUrl }
      });
    }
  };

  const handleRegenerateText = async () => {
    await regenerateContent.mutateAsync({
      outputId: output.id
    });
  };

  // Track if image is generating - check mutation state, persistent image_status, AND the local bridge flag
  // The image_status is set to 'generating' when prediction starts and cleared when webhook completes
  // imageGenerationRequested bridges the gap between mutation resolving and refetched data arriving
  const isImageGenerating = generateImage.isPending ||
    imageGenerationRequested ||
    data.image_status === 'generating' ||
    stageData.image?.status === 'generating';

  // Common layout props
  const layoutProps = {
    output,
    currentIndex,
    totalCount,
    onPrevious,
    onNext,
    onApprove,
    onReject,
    onDelete,
    onCopy,
    onUpdateText: handleUpdateText,
    onUpdateImage: handleUpdateImage,
    onRegenerateText: handleRegenerateText,
    onGenerateImage: handleGenerateImage,
    onRegenerateImage: handleRegenerateImage,
    isGeneratingImage: isImageGenerating,
    isRegeneratingText: regenerateContent.isPending,
  };

  // Route to appropriate layout based on pipeline type
  switch (pipeline) {
    case 'social_media_post':
      return <SocialMediaLayout {...layoutProps} />;

    case 'rich_article':
      return <ArticleLayout {...layoutProps} />;

    case 'video_script':
      return <ScriptLayout {...layoutProps} />;

    case 'image_only':
      return <ImageOnlyLayout {...layoutProps} />;

    // Default fallback for any other text-only pipelines
    default:
      return <ArticleLayout {...layoutProps} />;
  }
}
