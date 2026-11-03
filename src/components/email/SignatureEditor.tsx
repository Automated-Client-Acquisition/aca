import { useState, useRef, useCallback, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Code,
  Eye,
  Type,
  Bold,
  Italic,
  Underline,
  Link,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Image,
  Undo,
  Redo,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SignatureEditorProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  className?: string;
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            onClick();
          }}
          className="p-1.5 rounded hover:bg-muted transition-colors"
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolbarSeparator() {
  return <div className="w-px h-4 bg-border mx-0.5" />;
}

export function SignatureEditor({
  value,
  onChange,
  label = "Signature",
  hint,
  className,
}: SignatureEditorProps) {
  const [tab, setTab] = useState<string>("visual");
  const editorRef = useRef<HTMLDivElement>(null);
  // Track whether we need to push external value into the editor
  const lastPushedRef = useRef<string>(value);

  // Sync external value into contentEditable when switching TO visual tab,
  // or when value changes externally (e.g. from HTML tab) while visual is not active.
  useEffect(() => {
    if (tab === "visual" && editorRef.current) {
      // Only update DOM if the value actually differs from what's in the editor
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
      lastPushedRef.current = value;
    }
  }, [tab]); // Only on tab change — NOT on value change (that would kill cursor)

  const syncFromEditor = useCallback(() => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      // Browsers put <br> in empty contentEditable; treat as empty
      const normalized = html === "<br>" ? "" : html;
      lastPushedRef.current = normalized;
      onChange(normalized);
    }
  }, [onChange]);

  const exec = useCallback((command: string, val?: string) => {
    document.execCommand(command, false, val);
    syncFromEditor();
  }, [syncFromEditor]);

  const handleInsertLink = useCallback(() => {
    const url = prompt("Enter URL:");
    if (url) {
      exec("createLink", url);
    }
  }, [exec]);

  const handleInsertImage = useCallback(() => {
    const url = prompt("Enter image URL:");
    if (url) {
      exec("insertImage", url);
    }
  }, [exec]);

  return (
    <div className={cn("space-y-2", className)}>
      {label && <Label>{label}</Label>}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="h-8 w-full grid grid-cols-3">
          <TabsTrigger value="visual" className="text-xs gap-1.5">
            <Type className="w-3.5 h-3.5" />
            Visual
          </TabsTrigger>
          <TabsTrigger value="html" className="text-xs gap-1.5">
            <Code className="w-3.5 h-3.5" />
            HTML
          </TabsTrigger>
          <TabsTrigger value="preview" className="text-xs gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="visual" className="mt-2 space-y-0">
          {/* Toolbar */}
          <div className="flex items-center gap-0.5 flex-wrap border border-b-0 rounded-t-md px-2 py-1 bg-muted/30">
            <ToolbarButton icon={Bold} label="Bold" onClick={() => exec("bold")} />
            <ToolbarButton icon={Italic} label="Italic" onClick={() => exec("italic")} />
            <ToolbarButton icon={Underline} label="Underline" onClick={() => exec("underline")} />
            <ToolbarSeparator />
            <ToolbarButton icon={Link} label="Insert Link" onClick={handleInsertLink} />
            <ToolbarButton icon={Image} label="Insert Image" onClick={handleInsertImage} />
            <ToolbarSeparator />
            <ToolbarButton icon={List} label="Bullet List" onClick={() => exec("insertUnorderedList")} />
            <ToolbarButton icon={ListOrdered} label="Numbered List" onClick={() => exec("insertOrderedList")} />
            <ToolbarSeparator />
            <ToolbarButton icon={AlignLeft} label="Align Left" onClick={() => exec("justifyLeft")} />
            <ToolbarButton icon={AlignCenter} label="Align Center" onClick={() => exec("justifyCenter")} />
            <ToolbarButton icon={AlignRight} label="Align Right" onClick={() => exec("justifyRight")} />
            <ToolbarSeparator />
            <ToolbarButton icon={Minus} label="Horizontal Rule" onClick={() => exec("insertHorizontalRule")} />
            <ToolbarSeparator />
            <ToolbarButton icon={Undo} label="Undo" onClick={() => exec("undo")} />
            <ToolbarButton icon={Redo} label="Redo" onClick={() => exec("redo")} />
          </div>
          {/* Editable area — NOT controlled by React; synced imperatively */}
          <div
            ref={(node) => {
              editorRef.current = node;
              // Set initial content on mount
              if (node && node.innerHTML === "") {
                node.innerHTML = value;
                lastPushedRef.current = value;
              }
            }}
            contentEditable
            suppressContentEditableWarning
            onInput={syncFromEditor}
            onBlur={syncFromEditor}
            className="min-h-[160px] max-h-[320px] overflow-auto border rounded-b-md p-3 bg-white text-black text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full"
          />
        </TabsContent>

        <TabsContent value="html" className="mt-2">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste your HTML signature here, or type plain text..."
            rows={8}
            className="font-mono text-xs"
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-2">
          <div
            className="min-h-[160px] border rounded-md p-3 bg-white text-black text-sm overflow-auto [&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full"
            dangerouslySetInnerHTML={{
              __html: value || '<span style="color:#999">No signature set</span>',
            }}
          />
        </TabsContent>
      </Tabs>
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
