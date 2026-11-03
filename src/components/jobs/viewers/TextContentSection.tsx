import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Edit2, Check, X, RotateCcw, Loader2, FileText, PenLine } from "lucide-react";
import { toast } from "sonner";
import { RegenerateTextDialog } from "../dialogs/RegenerateTextDialog";
import { EmptyState } from "./EmptyState";

interface TextContentSectionProps {
  content: string;
  onUpdate?: (newContent: string) => void;
  onRegenerate?: (instructions?: string) => void;
  isEditable?: boolean;
  isRegenerating?: boolean;
  contentLabel?: string;
}

export function TextContentSection({
  content,
  onUpdate,
  onRegenerate,
  isEditable = true,
  isRegenerating = false,
  contentLabel = "Content"
}: TextContentSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const prevContentRef = useRef(content);

  // Close dialog when content changes (regeneration complete)
  useEffect(() => {
    if (prevContentRef.current !== content && !isRegenerating) {
      setShowRegenerateDialog(false);
      prevContentRef.current = content;
    }
  }, [content, isRegenerating]);

  // Update edited content when content changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditedContent(content);
    }
  }, [content, isEditing]);

  const handleRegenerate = (instructions: string) => {
    onRegenerate?.(instructions || undefined);
    // Don't close dialog - keep it open to show loading state
    // Dialog will close automatically when content changes
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  };

  const handleSave = () => {
    onUpdate?.(editedContent);
    setIsEditing(false);
    toast.success("Content updated");
  };

  const handleCancel = () => {
    setEditedContent(content);
    setIsEditing(false);
  };

  // Check if content contains HTML structure
  const isHtmlContent = /<(h[1-6]|p|div|ul|ol|blockquote|article|section|strong|em)[^>]*>/i.test(content);

  // For word count, strip HTML tags if present
  const plainTextContent = isHtmlContent
    ? content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    : content;
  const charCount = plainTextContent.length;
  const wordCount = plainTextContent.split(/\s+/).filter(Boolean).length;

  // Empty state when no content - allow manual entry if editable
  if (!content || content.trim() === '') {
    // If editable and currently editing, show the textarea
    if (isEditing) {
      return (
        <div className="space-y-4">
          <Textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="min-h-[200px] font-mono text-base leading-relaxed"
            placeholder={`Enter ${contentLabel.toLowerCase()} here...`}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!editedContent.trim()}>
              <Check className="h-4 w-4 mr-1" />
              Save
            </Button>
          </div>
        </div>
      );
    }

    // Show empty state with optional action to add content manually
    return (
      <EmptyState
        icon={FileText}
        title={`No ${contentLabel.toLowerCase()} yet`}
        message={isEditable && onUpdate
          ? `${contentLabel} will appear here once generated, or add it manually`
          : `${contentLabel} will appear here once generated`
        }
        actionLabel={isEditable && onUpdate ? "Add Manually" : undefined}
        onAction={isEditable && onUpdate ? () => setIsEditing(true) : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-muted-foreground">
          {charCount.toLocaleString()} characters · {wordCount.toLocaleString()} words
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave}>
                <Check className="h-4 w-4 mr-1" />
                Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-1" />
                Copy
              </Button>
              {isEditable && (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Edit2 className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
              {onRegenerate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRegenerateDialog(true)}
                  disabled={isRegenerating}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  {isRegenerating ? 'Regenerating...' : 'Regenerate'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <Textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          className="min-h-[400px] font-mono text-base leading-relaxed"
        />
      ) : (
        <div className="relative">
          {isHtmlContent ? (
            <div
              className={`bg-muted/30 rounded-xl p-6 text-base leading-relaxed border transition-opacity prose prose-slate dark:prose-invert max-w-none ${isRegenerating ? 'opacity-50' : ''}`}
              dangerouslySetInnerHTML={{ __html: content }}
            />
          ) : (
            <div className={`bg-muted/30 rounded-xl p-6 text-base leading-relaxed whitespace-pre-wrap border transition-opacity ${isRegenerating ? 'opacity-50' : ''}`}>
              {content}
            </div>
          )}
          {isRegenerating && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-xl">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm font-medium">Regenerating {contentLabel}...</span>
              </div>
            </div>
          )}
        </div>
      )}

      <RegenerateTextDialog
        open={showRegenerateDialog}
        onOpenChange={setShowRegenerateDialog}
        onRegenerate={handleRegenerate}
        isRegenerating={isRegenerating}
        currentContent={content}
        contentLabel={contentLabel}
      />
    </div>
  );
}
