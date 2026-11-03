import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Trash2, Check, X, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImageContentSection } from "../viewers/ImageContentSection";
import { useState } from "react";
import { SaveContentMultiDialog, type SaveableContent } from "@/components/saved-content/SaveContentMultiDialog";

interface ImageOnlyLayoutProps {
  output: any;
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onCopy?: () => void;
  onGenerateImage: (prompt: string) => void;
  onRegenerateImage: (prompt: string, instructions?: string) => void;
  onUpdateImage: (url: string | null) => void;
  isGeneratingImage: boolean;
}

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case 'approved': return 'bg-green-500/10 text-green-500 border-green-500/20';
    case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'review': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    case 'generating': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    default: return '';
  }
};

export function ImageOnlyLayout({
  output,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onApprove,
  onReject,
  onDelete,
  onGenerateImage,
  onRegenerateImage,
  onUpdateImage,
  isGeneratingImage,
}: ImageOnlyLayoutProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const data = output.data || {};
  const params = output.generation_params || {};
  const stageData = output.stage_data || {};
  const title = data.title || output.content_ideas?.title || 'Generated Image';

  // Get the image URL from stage_data.image (where webhook stores it)
  const imageUrl = stageData.image?.url || stageData.image?.image_url || data.image_url;
  const imagePrompt = params.resolved_image_prompt || params.image_prompt || stageData.image?.prompt || '';

  // Get aspect ratio from output_config
  const aspectRatio = params.output_config?.aspectRatio || params.outputConfig?.aspectRatio || 'landscape';

  // Context info
  const brandVoice = params.library_elements?.brand?.name || params.brand_voice?.name;
  const product = params.library_elements?.product?.name || params.product?.name;
  const character = params.library_elements?.character?.name || params.character?.name;

  // Build available content for save dialog
  const getAvailableContentForSave = (): SaveableContent[] => {
    const content: SaveableContent[] = [];
    if (imageUrl) {
      content.push({
        id: 'generated-image',
        contentType: 'image',
        content: { url: imageUrl },
        suggestedName: title || 'Generated Image',
        sourceStage: 'image',
        thumbnailUrl: imageUrl,
      });
    }
    return content;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-3 border-b">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold truncate">{title}</h2>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
              {brandVoice && <span className="text-xs">{brandVoice}</span>}
              {product && (
                <>
                  {brandVoice && <span>·</span>}
                  <span className="text-xs">{product}</span>
                </>
              )}
              {character && (
                <>
                  {(brandVoice || product) && <span>·</span>}
                  <span className="text-xs">{character}</span>
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
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          <ImageContentSection
            imageUrl={imageUrl}
            imagePrompt={imagePrompt}
            isRequired={true}
            onGenerateImage={onGenerateImage}
            onRegenerateImage={onRegenerateImage}
            onUpdateImage={onUpdateImage}
            isGenerating={isGeneratingImage || output.status === 'generating' || stageData.image?.status === 'generating'}
            aspectRatio={aspectRatio as 'landscape' | 'portrait' | 'square'}
          />
        </div>
      </div>

      {/* Actions Footer */}
      <div className="flex-shrink-0 p-4 border-t bg-background">
        <div className="flex gap-3 justify-end">
          {imageUrl && (
            <Button variant="outline" onClick={() => setShowSaveDialog(true)}>
              <Bookmark className="h-4 w-4 mr-2" />
              Save
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
            <Button variant="cta" onClick={onApprove} disabled={!imageUrl}>
              <Check className="h-4 w-4 mr-2" />
              Approve
            </Button>
          )}
        </div>
      </div>

      {/* Save Content Dialog */}
      <SaveContentMultiDialog
        open={showSaveDialog}
        onOpenChange={setShowSaveDialog}
        availableContent={getAvailableContentForSave()}
        sourceOutputId={output.id}
        sourceJobId={output.job_id}
        outputTitle={title}
      />
    </div>
  );
}
