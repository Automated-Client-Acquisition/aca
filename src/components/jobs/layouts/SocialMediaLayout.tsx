import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Copy, Trash2, Send, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { TextContentSection } from "../viewers/TextContentSection";
import { ImageContentSection } from "../viewers/ImageContentSection";
import { Badge } from "@/components/ui/badge";
import { PushToGHLDialog } from "../PushToGHLDialog";
import { useGHLConnection } from "@/hooks/useGHLConnection";
import { cn } from "@/lib/utils";

interface SocialMediaLayoutProps {
  output: any;
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  onCopy?: () => void;
  onUpdateText?: (newContent: string) => void;
  onUpdateImage?: (newImageUrl: string | null) => void;
  onRegenerateText?: (instructions?: string) => void;
  onGenerateImage?: (prompt: string) => void;
  onRegenerateImage?: (prompt: string, instructions?: string) => void;
  isGeneratingImage?: boolean;
  isRegeneratingText?: boolean;
}

const getStatusConfig = (status: string) => {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        icon: CheckCircle2,
        className: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
      };
    case 'rejected':
      return {
        label: 'Rejected',
        icon: XCircle,
        className: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30'
      };
    case 'review':
      return {
        label: 'Needs Review',
        icon: Clock,
        className: 'bg-[hsl(var(--status-warning))]/10 text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30'
      };
    case 'generating':
    case 'processing':
      return {
        label: 'Generating',
        icon: Loader2,
        className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
        loading: true
      };
    default:
      return {
        label: status,
        icon: Clock,
        className: 'bg-muted text-muted-foreground border-border'
      };
  }
};

export function SocialMediaLayout({
  output,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onApprove,
  onReject,
  onDelete,
  onCopy,
  onUpdateText,
  onUpdateImage,
  onRegenerateText,
  onGenerateImage,
  onRegenerateImage,
  isGeneratingImage = false,
  isRegeneratingText = false,
}: SocialMediaLayoutProps) {
  const [showPushDialog, setShowPushDialog] = useState(false);
  const { data: ghlConnection } = useGHLConnection();

  const data = output.data || {};
  const params = output.generation_params || {};
  const stageData = output.stage_data || {};
  const textContent = data.text || data.content || '';
  const imageUrl = data.image_url || data.imageUrl || stageData.image?.url || stageData.image?.image_url;
  // Get image prompt from multiple sources: data, stage_data, or resolved prompt from params
  const imagePrompt = data.image_prompt || data.imagePrompt || stageData.image?.prompt || params.resolved_image_prompt || params.image_prompt || '';

  // Get aspect ratio from output_config (same pattern as ImageOnlyLayout)
  const aspectRatio = params.output_config?.aspectRatio || params.outputConfig?.aspectRatio || 'landscape';

  // Get image stage status for visual indicator
  const imageStatus = stageData.image?.status as 'pending' | 'generating' | 'ready' | 'approved' | undefined;

  // Determine if we're awaiting approval on any stage
  const captionNeedsApproval = stageData.caption?.status === 'awaiting_approval';
  const imagePromptNeedsApproval = stageData.image_prompt?.status === 'awaiting_approval';
  const isAwaitingApproval = captionNeedsApproval || imagePromptNeedsApproval || output.status === 'review';

  // Get next action text for approve button
  const getApproveButtonText = () => {
    if (captionNeedsApproval) return 'Approve Caption';
    if (imagePromptNeedsApproval) return 'Approve & Generate Image';
    if (output.current_stage === 'caption') return 'Approve Caption';
    if (output.current_stage === 'image_prompt') return 'Approve & Generate Image';
    return 'Approve';
  };

  const title = data.title || params.idea?.title || 'Untitled Post';
  const isApproved = output.status === 'approved';

  // Check if caption is ready (for Publish button visibility)
  // Show Publish as soon as caption exists, regardless of image status
  const isCaptionReady = stageData.caption?.status === 'approved' || stageData.caption?.status === 'ready' || !!textContent;

  // Extract metadata for chips (character takes priority over brand voice)
  const characterName = params.character?.name || params.library_characters?.name;
  const brandVoiceName = params.brand_voice?.name || params.library_brand_voices?.name;
  const metadataLabel = characterName || brandVoiceName;

  const statusConfig = getStatusConfig(output.status);
  const StatusIcon = statusConfig.icon;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gradient-to-br from-background via-background to-muted/20">
      {/* Enhanced Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b bg-background/80 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <h3 className="text-lg font-semibold truncate">{title}</h3>
            {metadataLabel && (
              <span className="text-xs px-2.5 py-1 rounded-lg bg-muted text-muted-foreground shrink-0 font-medium border border-border/50">
                {metadataLabel}
              </span>
            )}
            <Badge variant="outline" className={cn("gap-1.5 px-2.5 py-1 rounded-lg font-medium", statusConfig.className)}>
              <StatusIcon className={cn("h-3.5 w-3.5", statusConfig.loading && "animate-spin")} />
              {statusConfig.label}
            </Badge>
          </div>
          <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={onPrevious}
              disabled={currentIndex === 0}
              className="h-8 w-8 rounded-md"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground whitespace-nowrap px-2 font-medium tabular-nums">
              {currentIndex + 1} / {totalCount}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onNext}
              disabled={currentIndex === totalCount - 1}
              className="h-8 w-8 rounded-md"
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Two-Column Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="h-full grid grid-cols-2 gap-8 p-6 pb-20">
          {/* Left Column: Caption Editor */}
          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/30">
                <h4 className="text-sm font-semibold text-foreground">Caption</h4>
                <p className="text-xs text-muted-foreground mt-0.5">Edit your social media caption</p>
              </div>
              <div className="p-4">
                <TextContentSection
                  content={textContent}
                  onUpdate={onUpdateText}
                  onRegenerate={onRegenerateText}
                  isRegenerating={isRegeneratingText}
                  contentLabel="Caption"
                />
              </div>
            </div>
          </div>

          {/* Right Column: Image Preview */}
          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/30">
                <h4 className="text-sm font-semibold text-foreground">Image</h4>
                <p className="text-xs text-muted-foreground mt-0.5">Preview and regenerate your image</p>
              </div>
              <div className="p-4">
                <ImageContentSection
                  imageUrl={imageUrl}
                  imagePrompt={imagePrompt}
                  onGenerateImage={onGenerateImage}
                  onRegenerateImage={onRegenerateImage}
                  onUpdateImage={onUpdateImage}
                  isGenerating={isGeneratingImage}
                  isRequired={true}
                  aspectRatio={aspectRatio as 'landscape' | 'portrait' | 'square'}
                  status={imageStatus}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Enhanced Sticky Footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t bg-background/95 backdrop-blur-sm shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onDelete} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
            {onCopy && (
              <Button variant="ghost" size="sm" onClick={onCopy} className="text-muted-foreground">
                <Copy className="h-4 w-4 mr-1.5" />
                Copy
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            {ghlConnection?.connected && isCaptionReady && (
              <Button
                variant="cta"
                size="sm"
                onClick={() => setShowPushDialog(true)}
                className="shadow-md hover:shadow-lg transition-all"
              >
                <Send className="h-4 w-4 mr-1.5" />
                Publish
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onReject}
              className="border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400"
            >
              <XCircle className="h-4 w-4 mr-1.5" />
              Reject
            </Button>
            <Button
              size="sm"
              onClick={onApprove}
              className={cn(
                "text-white shadow-md hover:shadow-lg transition-all min-w-[140px]",
                isAwaitingApproval
                  ? "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 animate-pulse-subtle ring-2 ring-green-500/30"
                  : "bg-green-600 hover:bg-green-700"
              )}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {getApproveButtonText()}
            </Button>
          </div>
        </div>
      </div>

      <PushToGHLDialog
        key={output.id}
        open={showPushDialog}
        onOpenChange={setShowPushDialog}
        outputId={output.id}
        outputTitle={title}
        outputData={output}
      />
    </div>
  );
}
