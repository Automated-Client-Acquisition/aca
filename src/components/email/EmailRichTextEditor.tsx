import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import DOMPurify from "dompurify";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  Code as CodeIcon,
  Eye,
  Palette,
  Highlighter,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { previewMessage } from "@/lib/message-variables";
import { VariableChip, SpintaxChip } from "@/lib/tiptap/variable-spintax-nodes";
import { LinkableImage } from "@/lib/tiptap/linkable-image-node";
import { useEmailImageUpload } from "@/hooks/useEmailImageUpload";
import {
  normalizeEmailEditorHtml,
  plainTextToEmailEditorHtml,
  rehydrateEmailEditorHtml,
} from "@/lib/email-editor-html";

const FONT_SIZES = [
  { label: "Small", value: "12px" },
  { label: "Normal", value: "14px" },
  { label: "Medium", value: "16px" },
  { label: "Large", value: "18px" },
  { label: "X-Large", value: "24px" },
  { label: "XX-Large", value: "32px" },
];

const TEXT_COLORS = ["#000000", "#DC2626", "#EA580C", "#16A34A", "#2563EB", "#7C3AED", "#DB2777"];
const HIGHLIGHT_COLORS = ["#FEF08A", "#BBF7D0", "#BFDBFE", "#FBCFE8", "#FED7AA"];

export interface EmailRichTextEditorHandle {
  insertVariableChip: (token: string) => void;
  insertSpintaxChip: (token: string) => void;
}

interface EmailRichTextEditorProps {
  value: string;
  /** 'html' means `value` is WYSIWYG-authored HTML; anything else is treated as legacy plain text. */
  bodyFormat?: "html" | "text";
  onChange: (html: string, format: "html") => void;
  placeholder?: string;
  minHeight?: number;
  /** Caps editor growth and scrolls internally past this height, instead of growing the composer unbounded. */
  maxHeight?: number;
  className?: string;
  /** Inbox composer can fill a resizable panel; other editor consumers retain their existing height. */
  fillHeight?: boolean;
  /** Hide formatting until requested in a compact reply composer. */
  showToolbar?: boolean;
  error?: boolean;
}

function looksLikeHtml(value: string): boolean {
  return /<(br|p|div|ul|ol|li|a|strong|em|b|i|u|span|h[1-6]|blockquote|img|table)[\s/>]/i.test(value);
}

function resolveHtml(value: string, bodyFormat?: "html" | "text"): string {
  if (bodyFormat === "html") return rehydrateEmailEditorHtml(value || "<p></p>");
  // Legacy steps have no body_format but already contain HTML (e.g. <br>)
  // after normalization — rendering those escaped shows literal tags.
  if (value && looksLikeHtml(value)) return rehydrateEmailEditorHtml(value);
  return plainTextToEmailEditorHtml(value || "");
}

/**
 * Drop stray empty `<li>` bullets (no text, no image/link) that surface as
 * blank dots in the sent email — most commonly left behind by pasting a list
 * from Google Docs/Word, which encodes blank spacer lines as empty list items.
 */
function stripEmptyListItems(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll("li").forEach((li) => {
    const hasText = (li.textContent || "").trim().length > 0;
    const hasMedia = li.querySelector("img, a, table");
    if (!hasText && !hasMedia) li.remove();
  });
  return container.innerHTML;
}

/**
 * Tiptap needs atomic spans to keep merge tags intact while editing, but those
 * spans are editor UI rather than email markup. Persisting them means a later
 * string-based resolver replaces the token both in `data-*-token` and in the
 * span's text, which corrupts attributes when the replacement is HTML (notably
 * {{signature}}) and renders the signature twice. Store the plain token only.
 */
function unwrapEditorTokenChips(html: string): string {
  return html.replace(
    /<span\b(?=[^>]*\bdata-(?:variable|spintax)-token\s*=)([^>]*)>[\s\S]*?<\/span>/gi,
    (_match, attributes: string) => {
      const token = attributes.match(
        /\bdata-(?:variable|spintax)-token\s*=\s*(["'])(.*?)\1/i
      );
      return token?.[2] || "";
    }
  );
}

function serializeEmailTemplate(html: string): string {
  return DOMPurify.sanitize(
    normalizeEmailEditorHtml(stripEmptyListItems(unwrapEditorTokenChips(html)))
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  isActive,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          onMouseDown={(e) => {
            e.preventDefault();
            onClick();
          }}
          className={cn(
            "p-1.5 rounded hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none",
            isActive && "bg-muted text-primary"
          )}
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

function SwatchPopover({
  icon: Icon,
  label,
  colors,
  onPick,
}: {
  icon: React.ElementType;
  label: string;
  colors: string[];
  onPick: (color: string) => void;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className="p-1.5 rounded hover:bg-muted transition-colors"
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex items-center gap-1.5">
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(color);
              }}
              className="h-6 w-6 rounded border shadow-sm transition-transform hover:scale-110"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const EmailRichTextEditor = forwardRef<EmailRichTextEditorHandle, EmailRichTextEditorProps>(
  function EmailRichTextEditor(
    { value, bodyFormat, onChange, placeholder, minHeight = 160, maxHeight, className, error, fillHeight = false, showToolbar = true },
    ref
  ) {
    const [view, setView] = useState<"edit" | "source" | "preview">("edit");
    const [sourceDraft, setSourceDraft] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { uploadImage, isUploading } = useEmailImageUpload();

    const editor = useEditor({
      extensions: [
        StarterKit.configure({ link: false, underline: false }),
        Underline,
        TextStyleKit.configure({ fontFamily: false, lineHeight: false, backgroundColor: false }),
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ["paragraph", "heading"] }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        }),
        VariableChip,
        SpintaxChip,
        LinkableImage,
      ],
      content: resolveHtml(value, bodyFormat),
      onUpdate: ({ editor }) => {
        onChange(serializeEmailTemplate(editor.getHTML()), "html");
      },
      editorProps: {
        attributes: {
          "aria-label": "Reply message",
          class: cn("email-rte-content focus:outline-none p-3", fillHeight && "min-h-full text-[15px] leading-relaxed"),
          style: fillHeight ? "min-height: 100%;" : maxHeight
            ? `min-height: ${minHeight}px; max-height: ${maxHeight}px; overflow-y: auto;`
            : `min-height: ${minHeight}px`,
        },
      },
    }, [minHeight, maxHeight, fillHeight]);
    // No effect resyncing `value` back into the editor on every prop change:
    // both call sites (SequenceStepEditor's compact/expanded toggle,
    // ABVariantEditor's variant Cards keyed by stable variant_label) fully
    // unmount and remount this component whenever it should show different
    // content, seeding fresh via the `content:` option above. The only thing
    // that changes `value` while an instance stays mounted is its own typing
    // echoing back through the parent's state — resyncing from that prop would
    // race the editor's live state during fast typing (the effect could see a
    // stale snapshot after the editor has already moved on) and silently
    // revert recent keystrokes, most visibly right after a paragraph break.

    useImperativeHandle(
      ref,
      () => ({
        insertVariableChip: (token: string) => {
          editor?.chain().focus().insertContent({ type: "variableChip", attrs: { token } }).run();
        },
        insertSpintaxChip: (token: string) => {
          editor?.chain().focus().insertContent({ type: "spintaxChip", attrs: { token } }).run();
        },
      }),
      [editor]
    );

    if (!editor) return null;

    const enterSourceMode = () => {
      setSourceDraft(serializeEmailTemplate(editor.getHTML()));
      setView("source");
    };

    const commitSourceDraft = () => {
      const sanitized = DOMPurify.sanitize(sourceDraft);
      editor.commands.setContent(rehydrateEmailEditorHtml(sanitized || "<p></p>"), { emitUpdate: false });
      // Send the editor's own normalized HTML, not the raw pasted/typed draft —
      // otherwise malformed source-mode HTML ships to the recipient untouched.
      onChange(serializeEmailTemplate(editor.getHTML()), "html");
    };

    const handleLinkClick = () => {
      if (editor.isActive("linkableImage")) {
        const current = (editor.getAttributes("linkableImage").href as string) || "";
        const url = window.prompt("Link URL for this image (leave empty to remove):", current);
        if (url === null) return;
        editor
          .chain()
          .focus()
          .updateAttributes("linkableImage", { href: url.trim() || null })
          .run();
        return;
      }

      const current = (editor.getAttributes("link").href as string) || "";
      const url = window.prompt("Link URL (leave empty to remove):", current);
      if (url === null) return;
      if (!url.trim()) {
        editor.chain().focus().extendMarkRange("link").unsetLink().run();
        return;
      }
      editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
    };

    const handleImageButtonClick = () => {
      fileInputRef.current?.click();
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const url = await uploadImage(file);
      if (url) {
        editor
          .chain()
          .focus()
          .insertContent({ type: "linkableImage", attrs: { src: url, alt: file.name } })
          .run();
      }
    };

    const isEmpty = editor.isEmpty;

    return (
      <div className={cn("space-y-0", fillHeight && "flex h-full min-h-0 flex-1 flex-col", className)}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFileSelected}
        />

        {/* Toolbar */}
        {showToolbar && <div className={cn("flex shrink-0 items-center gap-0.5 flex-wrap border border-b-0 rounded-t-md px-2 py-1 bg-muted/30", fillHeight && "max-h-9 overflow-y-auto")}>
          <ToolbarButton
            icon={BoldIcon}
            label="Bold"
            isActive={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            icon={ItalicIcon}
            label="Italic"
            isActive={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            icon={UnderlineIcon}
            label="Underline"
            isActive={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <ToolbarButton
            icon={Strikethrough}
            label="Strikethrough"
            isActive={editor.isActive("strike")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />
          <ToolbarSeparator />
          <ToolbarButton
            icon={AlignLeft}
            label="Align Left"
            isActive={editor.isActive({ textAlign: "left" })}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
          />
          <ToolbarButton
            icon={AlignCenter}
            label="Align Center"
            isActive={editor.isActive({ textAlign: "center" })}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
          />
          <ToolbarButton
            icon={AlignRight}
            label="Align Right"
            isActive={editor.isActive({ textAlign: "right" })}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
          />
          <ToolbarSeparator />
          <SwatchPopover
            icon={Palette}
            label="Text Color"
            colors={TEXT_COLORS}
            onPick={(color) => editor.chain().focus().setColor(color).run()}
          />
          <SwatchPopover
            icon={Highlighter}
            label="Highlight"
            colors={HIGHLIGHT_COLORS}
            onPick={(color) => editor.chain().focus().toggleHighlight({ color }).run()}
          />
          <ToolbarSeparator />
          <ToolbarButton
            icon={List}
            label="Bullet List"
            isActive={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            icon={ListOrdered}
            label="Numbered List"
            isActive={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarSeparator />
          <Select
            onValueChange={(size) => editor.chain().focus().setFontSize(size).run()}
          >
            <SelectTrigger className="h-6 w-[72px] text-[11px] px-1.5">
              <SelectValue placeholder="Size" />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToolbarSeparator />
          <ToolbarButton
            icon={CodeIcon}
            label="View HTML Source"
            isActive={view === "source"}
            onClick={() => {
              if (view === "source") {
                commitSourceDraft();
                setView("edit");
              } else {
                enterSourceMode();
              }
            }}
          />
          <ToolbarButton
            icon={LinkIcon}
            label="Insert Link"
            isActive={editor.isActive("link")}
            onClick={handleLinkClick}
            disabled={view !== "edit"}
          />
          <ToolbarButton
            icon={isUploading ? Loader2 : ImageIcon}
            label="Insert Image"
            onClick={handleImageButtonClick}
            disabled={isUploading || view !== "edit"}
          />
          <div className="ml-auto">
            <ToolbarButton
              icon={Eye}
              label="Preview"
              isActive={view === "preview"}
              onClick={() => {
                if (view === "source") commitSourceDraft();
                setView((v) => (v === "preview" ? "edit" : "preview"));
              }}
            />
          </div>
        </div>}

        {/* Body */}
        {view === "source" && (
          <Textarea
            value={sourceDraft}
            onChange={(e) => setSourceDraft(e.target.value)}
            onBlur={commitSourceDraft}
            className={cn("font-mono text-xs rounded-t-none", fillHeight && "min-h-0 flex-1 resize-none")}
            style={fillHeight ? undefined : { minHeight }}
          />
        )}

        {view === "preview" && (
          <div
            className={cn(
              "border rounded-b-md p-3 bg-white text-black text-sm overflow-auto",
              "[&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full",
              fillHeight && "min-h-0 flex-1",
              !showToolbar && "rounded-md"
            )}
            style={fillHeight ? undefined : { minHeight }}
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(previewMessage(serializeEmailTemplate(editor.getHTML()))),
            }}
          />
        )}

        {view === "edit" && (
          <div className={cn("relative", fillHeight && "min-h-0 flex-1")}>
            {isEmpty && placeholder && (
              <p className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground line-clamp-3">
                {placeholder}
              </p>
            )}
            <EditorContent
              editor={editor}
              className={cn(
                "email-rte overflow-auto border rounded-b-md bg-white text-black text-sm",
                fillHeight && "h-full min-h-0 [&_.tiptap]:text-[15px] [&_.tiptap]:leading-relaxed [&_.tiptap_p]:my-2",
                !showToolbar && "rounded-md",
                "[&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full",
                "[&_.email-editor-chip]:rounded [&_.email-editor-chip]:px-1 [&_.email-editor-chip]:py-0.5 [&_.email-editor-chip]:text-xs [&_.email-editor-chip]:font-mono",
                "[&_.email-editor-chip--variable]:bg-blue-100 [&_.email-editor-chip--variable]:text-blue-700",
                "[&_.email-editor-chip--spintax]:bg-purple-100 [&_.email-editor-chip--spintax]:text-purple-700",
                error && "border-red-500"
              )}
            />
          </div>
        )}
      </div>
    );
  }
);
