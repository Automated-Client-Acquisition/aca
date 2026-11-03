import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Copy, Trash2, Bookmark } from "lucide-react";
import { TextContentSection } from "../viewers/TextContentSection";
import { LoadingState } from "../viewers/LoadingState";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { SaveContentMultiDialog } from "@/components/saved-content/SaveContentMultiDialog";

interface ScriptLayoutProps {
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
  onRegenerateText?: (instructions?: string) => void;
  isRegeneratingText?: boolean;
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved':
      return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20';
    case 'rejected':
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20';
    case 'review':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
    default:
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20';
  }
};

export function ScriptLayout({
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
  onRegenerateText,
  isRegeneratingText = false,
}: ScriptLayoutProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const data = output.data || {};
  const params = output.generation_params || {};
  const stageData = output.stage_data || {};
  const textContent = data.text || data.content || data.script || stageData.text?.content || '';

  const title = data.title || params.idea?.title || 'Untitled Script';
  const wordCount = textContent.trim().split(/\s+/).filter(Boolean).length;
  const estimatedDuration = Math.ceil(wordCount / 150); // ~150 words per minute for scripts

  // Extract metadata for chips (character takes priority over brand voice)
  const characterName = params.character?.name || params.library_characters?.name;
  const brandVoiceName = params.brand_voice?.name || params.library_brand_voices?.name;
  const metadataLabel = characterName || brandVoiceName;

  // Build available content for save dialog
  const getAvailableContentForSave = () => {
    const content: Array<{
      id: string;
      contentType: 'text' | 'image' | 'video' | 'audio';
      content: Record<string, any>;
      suggestedName: string;
      sourceStage: string;
      preview?: string;
    }> = [];

    if (textContent) {
      content.push({
        id: 'text',
        contentType: 'text',
        content: { text: textContent, format: 'markdown' },
        suggestedName: `${title} - Script`,
        sourceStage: 'text',
        preview: textContent.substring(0, 150) + (textContent.length > 150 ? '...' : ''),
      });
    }
    return content;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Compact Header - 48px */}
      <div className="flex-shrink-0 h-12 px-6 border-b flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <h3 className="font-semibold truncate">{title}</h3>
          {metadataLabel && (
            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              {metadataLabel}
            </span>
          )}
          <Badge className={getStatusColor(output.status)}>
            {output.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onPrevious}
            disabled={currentIndex === 0}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
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

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {output.status === 'generating' && !textContent ? (
            <LoadingState
              message="Generating script..."
              submessage="Your script is being written by AI"
            />
          ) : (
            <>
              {/* Script Metadata */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{wordCount.toLocaleString()} words</span>
                <span>·</span>
                <span>~{estimatedDuration} min duration</span>
              </div>

              {/* Script Content */}
              <TextContentSection
                content={textContent}
                onUpdate={onUpdateText}
                onRegenerate={onRegenerateText}
                isRegenerating={isRegeneratingText}
                contentLabel="Script"
              />
            </>
          )}
        </div>
      </div>

      {/* Sticky Footer - 56px */}
      <div className="flex-shrink-0 h-14 px-6 border-t bg-background flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
          {onCopy && (
            <Button variant="ghost" size="sm" onClick={onCopy}>
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
          )}
          {textContent && (
            <Button variant="ghost" size="sm" onClick={() => setShowSaveDialog(true)}>
              <Bookmark className="h-4 w-4 mr-1" />
              Save to Library
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onReject}>
            Reject
          </Button>
          <Button size="sm" onClick={onApprove}>
            Approve
          </Button>
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
