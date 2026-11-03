import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Copy, Check, Eye, EyeOff, Maximize2, Minimize2, Code, FileText, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Markdown syntax help content
const MARKDOWN_HELP = [
  { syntax: "# Heading 1", description: "Large heading" },
  { syntax: "## Heading 2", description: "Medium heading" },
  { syntax: "### Heading 3", description: "Small heading" },
  { syntax: "**bold text**", description: "Bold text" },
  { syntax: "*italic text*", description: "Italic text" },
  { syntax: "- Item", description: "Bullet list" },
  { syntax: "1. Item", description: "Numbered list" },
  { syntax: "[Link](url)", description: "Hyperlink" },
  { syntax: "> Quote", description: "Block quote" },
  { syntax: "`code`", description: "Inline code" },
  { syntax: "```\ncode block\n```", description: "Code block" },
  { syntax: "---", description: "Horizontal line" },
  { syntax: "| Col1 | Col2 |\n|------|------|\n| A    | B    |", description: "Table" },
];

// Markdown Help Popover Component
function MarkdownHelpPopover({ container }: { container?: HTMLElement | null }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
        >
          <HelpCircle className="h-4 w-4" />
          <span className="text-xs">Syntax Help</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 z-[100]" align="start" container={container}>
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Markdown Syntax Guide</h4>
          <div className="grid gap-1.5">
            {MARKDOWN_HELP.map((item, index) => (
              <div key={index} className="flex items-start gap-3 text-xs">
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono shrink-0 whitespace-pre">
                  {item.syntax.split('\n')[0]}
                </code>
                <span className="text-muted-foreground">{item.description}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground pt-2 border-t">
            See the preview panel for how your content will look.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type EditorMode = "markdown" | "plain";

// Convert markdown to plain text by stripping formatting
function markdownToPlainText(markdown: string): string {
  return markdown
    // Remove headers (# ## ### etc)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove links but keep text [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove images ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^---+$/gm, '')
    .replace(/^\*\*\*+$/gm, '')
    .replace(/^___+$/gm, '')
    // Convert bullet lists to plain text
    .replace(/^[\s]*[-*+]\s+/gm, '• ')
    // Convert numbered lists - keep the numbers
    .replace(/^[\s]*(\d+)\.\s+/gm, '$1. ')
    // Remove strikethrough
    .replace(/~~(.+?)~~/g, '$1')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface ContentEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  defaultMode?: EditorMode;
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

export function ContentEditor({
  value,
  onChange,
  placeholder = "Enter your content...",
  minHeight = "400px",
  className,
  defaultMode = "markdown",
  onFullscreenChange,
}: ContentEditorProps) {
  const [mode, setMode] = useState<EditorMode>(defaultMode);
  const [showPreview, setShowPreview] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dialogMounted, setDialogMounted] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Handle fullscreen toggle using native dialog
  const handleFullscreenToggle = useCallback(() => {
    const newExpandedState = !isExpanded;
    setIsExpanded(newExpandedState);
    onFullscreenChange?.(newExpandedState);

    if (newExpandedState && dialogRef.current) {
      dialogRef.current.showModal();
      // Trigger re-render so dialogRef.current is available for popover container
      setDialogMounted(true);
    } else if (dialogRef.current) {
      dialogRef.current.close();
      setDialogMounted(false);
    }
  }, [isExpanded, onFullscreenChange]);

  // Handle dialog close via Escape key or backdrop click
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      setIsExpanded(false);
      setDialogMounted(false);
      onFullscreenChange?.(false);
    };

    const handleCancel = (e: Event) => {
      e.preventDefault();
      handleClose();
    };

    const handleBackdropClick = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width
      );
      if (!isInDialog) {
        handleClose();
      }
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('click', handleBackdropClick);

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, [onFullscreenChange]);

  // Handle mode switching with content conversion
  const handleModeChange = useCallback((newMode: EditorMode) => {
    if (newMode === "plain" && mode === "markdown" && value) {
      // Convert markdown to plain text
      const plainText = markdownToPlainText(value);
      onChange(plainText);
    }
    setMode(newMode);
  }, [mode, value, onChange]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Content copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy content");
    }
  };

  const handleCopyFormatted = async () => {
    if (mode === "plain") {
      return handleCopy();
    }

    try {
      if (previewRef.current) {
        const htmlContent = previewRef.current.innerHTML;
        const plainText = previewRef.current.innerText;

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });

        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': blob,
            'text/plain': textBlob,
          }),
        ]);

        setCopied(true);
        toast.success("Formatted content copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      handleCopy();
    }
  };

  // Render the toolbar
  const renderToolbar = (isFullscreen: boolean, popoverContainer?: HTMLElement | null) => (
    <div className="flex items-center justify-between gap-2 pb-2 border-b mb-2">
      <div className="flex items-center gap-1">
        {/* Mode Toggle */}
        <div className="flex items-center rounded-md border bg-muted/30 p-0.5 mr-2">
          <Button
            type="button"
            variant={mode === "plain" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => handleModeChange("plain")}
            className="gap-1.5 h-7 px-2"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="text-xs">Plain</span>
          </Button>
          <Button
            type="button"
            variant={mode === "markdown" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => handleModeChange("markdown")}
            className="gap-1.5 h-7 px-2"
          >
            <Code className="h-3.5 w-3.5" />
            <span className="text-xs">Markdown</span>
          </Button>
        </div>

        {/* Preview Toggle - only show in markdown mode */}
        {mode === "markdown" && (
          <Toggle
            pressed={showPreview}
            onPressedChange={setShowPreview}
            size="sm"
            aria-label="Toggle preview"
            className="gap-1.5"
          >
            {showPreview ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            <span className="text-xs">Preview</span>
          </Toggle>
        )}

        {/* Markdown Help - only show in markdown mode */}
        {mode === "markdown" && <MarkdownHelpPopover container={popoverContainer} />}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleFullscreenToggle}
          className="gap-1.5"
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          <span className="text-xs">{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopyFormatted}
          className="gap-1.5"
          disabled={!value}
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          <span className="text-xs">{mode === "markdown" ? "Copy Formatted" : "Copy"}</span>
        </Button>
      </div>
    </div>
  );

  // Render the editor content
  const renderEditorContent = (height: string, isFullscreen: boolean) => (
    <div style={{ height }} className="flex flex-col">
      {mode === "plain" ? (
        /* Plain Text Mode - Simple textarea with scroll */
        <div className="h-full rounded-lg border overflow-hidden flex flex-col">
          <div className="shrink-0 px-3 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
            Text Editor
          </div>
          <div className="flex-1 min-h-0">
            <textarea
              ref={isFullscreen ? textareaRef : undefined}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="h-full w-full resize-none border-0 rounded-none text-sm p-3 bg-background focus:outline-none focus:ring-0"
              style={{ overflow: 'auto' }}
            />
          </div>
        </div>
      ) : showPreview ? (
        /* Markdown Mode with Preview */
        <ResizablePanelGroup direction="horizontal" className="h-full rounded-lg border overflow-hidden">
          {/* Editor Panel */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col">
              <div className="shrink-0 px-3 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
                Markdown Editor
              </div>
              <div className="flex-1 min-h-0">
                <textarea
                  ref={isFullscreen ? textareaRef : undefined}
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={placeholder}
                  className="h-full w-full resize-none border-0 rounded-none font-mono text-sm p-3 bg-background focus:outline-none focus:ring-0"
                  style={{ overflow: 'auto' }}
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Preview Panel */}
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col bg-white dark:bg-zinc-950 overflow-hidden">
              <div className="shrink-0 px-3 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
                Preview
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <div
                  ref={previewRef}
                  className="p-4 prose prose-sm dark:prose-invert max-w-none
                    prose-headings:font-semibold
                    prose-h1:text-2xl prose-h1:border-b prose-h1:pb-2 prose-h1:mb-4
                    prose-h2:text-xl prose-h2:mt-6 prose-h2:mb-3
                    prose-h3:text-lg prose-h3:mt-4 prose-h3:mb-2
                    prose-p:my-2 prose-p:leading-relaxed
                    prose-ul:my-2 prose-ol:my-2
                    prose-li:my-0.5
                    prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
                    prose-pre:bg-muted prose-pre:p-4 prose-pre:rounded-lg
                    prose-blockquote:border-l-primary prose-blockquote:bg-muted/30 prose-blockquote:py-1 prose-blockquote:px-4
                    prose-hr:my-6
                    prose-strong:font-semibold
                    prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                    prose-table:border-collapse prose-table:w-full prose-table:my-4
                    prose-th:border prose-th:border-border prose-th:bg-muted/50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold
                    prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2"
                >
                  {value ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
                  ) : (
                    <p className="text-muted-foreground italic">
                      Start typing in the editor to see the preview...
                    </p>
                  )}
                </div>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        /* Markdown Mode without Preview */
        <div className="h-full rounded-lg border overflow-hidden flex flex-col">
          <div className="shrink-0 px-3 py-2 border-b bg-muted/30 text-xs font-medium text-muted-foreground">
            Markdown Editor
          </div>
          <div className="flex-1 min-h-0">
            <textarea
              ref={isFullscreen ? textareaRef : undefined}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="h-full w-full resize-none border-0 rounded-none font-mono text-sm p-3 bg-background focus:outline-none focus:ring-0"
              style={{ overflow: 'auto' }}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Normal (non-fullscreen) editor */}
      <div className={cn("flex flex-col bg-background", className)}>
        {renderToolbar(false)}
        {renderEditorContent(minHeight, false)}
      </div>

      {/* Fullscreen dialog - uses native HTML dialog element */}
      <dialog
        ref={dialogRef}
        className="fixed inset-0 w-full h-full max-w-none max-h-none m-0 p-6 bg-background border-none outline-none"
        style={{
          width: '100vw',
          height: '100vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div ref={dialogContentRef} className="flex flex-col h-full bg-background">
          {renderToolbar(true, dialogMounted ? dialogRef.current : undefined)}
          {renderEditorContent("calc(100vh - 80px)", true)}
        </div>
      </dialog>
    </>
  );
}

// Re-export as MarkdownEditor for backward compatibility
export { ContentEditor as MarkdownEditor };
