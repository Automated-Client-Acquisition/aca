import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, AlertCircle, Copy, Trash2, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { StageConfig } from "@/types/pipelineStages";
import { TextContentSection } from "./viewers/TextContentSection";
import { ImageContentSection } from "./viewers/ImageContentSection";
import { ErrorState } from "./viewers/ErrorState";
import { EmptyState } from "./viewers/EmptyState";
import { useGenerateImage } from "@/hooks/useGenerateImage";
import { useUpdateContentOutput } from "@/hooks/useUpdateContentOutput";
import { useRegenerateContent } from "@/hooks/useRegenerateContent";

interface SingleContentDetailPanelProps {
  output: any;
  stages: StageConfig[];
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onCopy?: () => void;
}

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'approved': return 'bg-green-500/10 text-green-500 border-green-500/20';
    case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'review': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    default: return '';
  }
};

export function SingleContentDetailPanel({
  output,
  stages,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onApprove,
  onReject,
  onDelete,
  onCopy,
}: SingleContentDetailPanelProps) {
  const data = output.data || {};
  const params = output.generation_params || {};
  const title = data.title || output.content_ideas?.title || 'Untitled';
  
  const brandVoice = params.brand_voice?.name || params.brand_voice;
  const angle = params.block?.name || params.angle;
  const product = params.product?.name || params.product;

  // Find text and image stages
  const textStage = stages.find(s => s.type === 'text' || s.type === 'script');
  const imageStage = stages.find(s => s.type === 'image');

  // Image generation hooks
  const generateImage = useGenerateImage();
  const updateOutput = useUpdateContentOutput();
  const regenerateContent = useRegenerateContent();

  // Get reference image from generation params if available
  const referenceImage = output.generation_params?.image_inputs?.[0] || null;

  const handleGenerateImage = async (prompt: string) => {
    await generateImage.mutateAsync({
      outputId: output.id,
      prompt,
      referenceImage
    });
  };

  const handleUpdateText = async (newText: string) => {
    await updateOutput.mutateAsync({
      id: output.id,
      data: { ...data, text: newText }
    });
  };

  const handleRegenerateText = async (instructions?: string) => {
    await regenerateContent.mutateAsync({
      outputId: output.id,
      instructions
    });
  };

  return (
    <div className="h-full flex flex-col overflow-x-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-3 border-b">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold truncate">{title}</h2>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
              {brandVoice && <span className="text-xs">{brandVoice}</span>}
              {angle && (
                <>
                  {brandVoice && <span>·</span>}
                  <span className="text-xs">{angle}</span>
                </>
              )}
              {product && (
                <>
                  {(brandVoice || angle) && <span>·</span>}
                  <span className="text-xs">{product}</span>
                </>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-3 shrink-0">
            <Badge 
              variant="outline"
              className={cn("capitalize", getStatusBadgeColor(output.status))}
            >
              {output.status}
            </Badge>
            
            {/* Navigation */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={onPrevious}
                disabled={currentIndex === 0}
                className="h-8 w-8"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              
              <span className="text-xs text-muted-foreground">
                {currentIndex + 1} / {totalCount}
              </span>
              
              <Button
                variant="ghost"
                size="icon"
                onClick={onNext}
                disabled={currentIndex === totalCount - 1}
                className="h-8 w-8"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          {/* Text Content */}
          {textStage && data.text && (
            <div>
              <h3 className="text-lg font-semibold mb-3">{textStage.label}</h3>
            <TextContentSection
              content={data.text}
              onUpdate={handleUpdateText}
              onRegenerate={handleRegenerateText}
              isRegenerating={regenerateContent.isPending}
              contentLabel={textStage?.label || "Content"}
            />
          </div>
        )}

          {/* Image Content (Optional or Required) */}
          {imageStage && (
            <div>
              <h3 className="text-lg font-semibold mb-3">
                {imageStage.label}
                {!imageStage.required && <span className="text-sm text-muted-foreground ml-2">(Optional)</span>}
              </h3>
            <ImageContentSection
              imageUrl={data.image_url}
              imagePrompt={data.image_prompt}
              isRequired={imageStage.required}
              onGenerateImage={handleGenerateImage}
              onRegenerateImage={handleGenerateImage}
              isGenerating={generateImage.isPending || data.image_status === 'generating'}
            />
          </div>
        )}

        {/* Error State */}
        {output.error_message && (
          <ErrorState
            title="Generation Error"
            message={output.error_message}
            onRetry={handleRegenerateText}
            isRetrying={regenerateContent.isPending}
          />
        )}

          {/* Empty State */}
          {!data.text && !imageStage && !output.error_message && (
            <EmptyState
              title="No Content Generated"
              message="This output doesn't have any content yet. Try regenerating to create content."
              actionLabel="Regenerate"
              onAction={handleRegenerateText}
            />
          )}
        </div>
      </div>

      {/* Actions Footer */}
      <div className="flex-shrink-0 p-4 border-t bg-background">
        <div className="flex gap-3 justify-end">
          {onCopy && (
            <Button variant="outline" onClick={onCopy}>
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
          )}
          <Button variant="outline" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          {output.status !== 'rejected' && (
            <Button variant="destructive" onClick={onReject}>
              <X className="h-4 w-4 mr-2" />
              Reject
            </Button>
          )}
          {output.status !== 'approved' && (
            <Button variant="cta" onClick={onApprove}>
              <Check className="h-4 w-4 mr-2" />
              Approve
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
