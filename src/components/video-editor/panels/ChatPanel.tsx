import { useState, useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useVideoEditor } from "../context/VideoEditorContext";
import { useEditorChat } from "@/hooks/useEditorChat";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ApiKeyBanner } from "./ApiKeyBanner";
import type { ChatMessage, ToolCallDisclosure, DocumentBlock } from "@/types/editorChat";
import {
  Send,
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
  Trash2,
  Zap,
  ChevronDown,
  FileText,
  Search,
  Video,
  Folder,
  Image,
  LayoutGrid,
  Mic,
  Settings,
  FileEdit,
  Music,
  Paperclip,
  Film,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { LLM_MODELS, IMAGE_MODELS, VIDEO_MODELS, DEFAULT_LLM_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from "@/lib/media-models";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── Templates ──────────────────────────────────────────────────────

interface Template {
  command: string;
  label: string;
  description: string;
  prompt: string;
}

const TEMPLATES: Template[] = [
  {
    command: "/news",
    label: "News Roundup",
    description: "Research & build an AI news video",
    prompt:
      "Search the web for the top 5 AI or tech news stories from the last 7 days. Then create a portrait video with 6-8 scenes covering each story. Use stock video/photos for each headline and add a bold voiceover script summarizing the key points.",
  },
  {
    command: "/ad",
    label: "Social Ad",
    description: "High-converting short-form ad",
    prompt:
      "Create a 30-second social media ad video in portrait format. Structure it as: 1) Hook scene (3s, bold text), 2) Problem scene (4s), 3) Solution scene (5s), 4) Features/benefits (3 scenes, 4s each), 5) CTA scene (5s). Use energetic slide transitions and a bold_punch caption style.",
  },
  {
    command: "/tutorial",
    label: "Tutorial",
    description: "Step-by-step tutorial video",
    prompt:
      "Create a tutorial walkthrough video in landscape format. Structure it as: 1) Title/intro scene, 2) Overview of what we'll learn, 3-7) Step-by-step scenes with clear text overlays explaining each step, 8) Summary/recap scene. Use fade transitions and minimal caption style.",
  },
  {
    command: "/story",
    label: "Brand Story",
    description: "Emotional brand narrative",
    prompt:
      "Create an emotional brand story video in portrait format with 6 scenes: 1) The dream/aspiration, 2) The struggle/problem, 3) The turning point, 4) The solution/product, 5) The transformation/result, 6) The call to action. Use fade transitions, cinematic stock footage, and a voiceover script that connects emotionally.",
  },
  {
    command: "/product",
    label: "Product Demo",
    description: "Showcase a product's features",
    prompt:
      "Create a product demonstration video in portrait format. Build 7 scenes: 1) Hero shot with product name, 2) Key problem it solves, 3-5) Three core features/benefits (each with stock visuals and text overlay), 6) Social proof/results, 7) CTA with offer. Use slide transitions for energy.",
  },
  {
    command: "/improve",
    label: "Improve Script",
    description: "Analyze & improve your transcript for engagement",
    prompt:
      "Analyze my video transcript and suggest specific improvements to make the script more engaging, punchy, and optimized for short-form video. Identify weak openings, slow sections, and filler content. Then provide a rewritten version that's tighter and more impactful.",
  },
  {
    command: "/broll",
    label: "B-Roll Suggestions",
    description: "Generate stock video queries for each key topic",
    prompt:
      "Based on my transcript, identify 5-8 key topics or moments and suggest specific B-roll stock video search queries for each one. Then create scenes with those stock videos to complement the existing content. Include text overlays that echo key phrases from the transcript.",
  },
  {
    command: "/rewrite",
    label: "Rewrite Script",
    description: "Rewrite transcript for short-form video",
    prompt:
      "Rewrite my transcript as an optimized short-form video script: 1) Start with a strong hook in the first 3 seconds, 2) Use short punchy sentences, 3) Build to a clear point or takeaway, 4) End with a compelling CTA or cliffhanger. Keep the same core message but make every word count.",
  },
  {
    command: "/chapters",
    label: "Add Chapters",
    description: "Break transcript into chapter title cards",
    prompt:
      "Analyze my transcript and break it into 3-5 natural chapters or sections. For each chapter, create a title card scene (3s, color background, bold text overlay) that introduces that section. Insert these title card scenes at the appropriate positions in the timeline.",
  },
];

// ── Suggestion chips ───────────────────────────────────────────────

const SUGGESTIONS = [
  "AI news roundup",
  "Product demo video",
  "Tutorial walkthrough",
  "Social media ad",
];

// ── Tool icon map ──────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ElementType> = {
  search: Search,
  video: Video,
  folder: Folder,
  image: Image,
  layout: LayoutGrid,
  mic: Mic,
  settings: Settings,
  "file-edit": FileEdit,
  music: Music,
  "file-text": FileText,
};

// ── Tool Call Disclosure ───────────────────────────────────────────

function ToolDisclosure({ disclosure }: { disclosure: ToolCallDisclosure }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[disclosure.icon] || Zap;

  return (
    <div
      className={cn(
        "rounded-md text-[10px] border w-full overflow-hidden",
        disclosure.status === "running" && "bg-blue-500/10 border-blue-500/20 text-blue-400",
        disclosure.status === "completed" && "bg-muted/50 border-border text-muted-foreground",
        disclosure.status === "failed" && "bg-red-500/10 border-red-500/20 text-red-400"
      )}
    >
      <button
        onClick={() => disclosure.summary && setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2 py-1 w-full text-left transition-colors hover:bg-white/5"
      >
        {disclosure.status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
        ) : disclosure.status === "completed" ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" />
        ) : (
          <XCircle className="h-3 w-3 flex-shrink-0" />
        )}
        <Icon className="h-2.5 w-2.5 flex-shrink-0 opacity-60" />
        <span className="flex-1 font-medium truncate">{disclosure.label}</span>
        {disclosure.summary && disclosure.status !== "running" && (
          <span className="text-[9px] opacity-50 truncate max-w-[70px] flex-shrink-0">{disclosure.summary}</span>
        )}
        {disclosure.summary && (
          <ChevronDown className={cn("h-2.5 w-2.5 flex-shrink-0 transition-transform opacity-50 ml-0.5", expanded && "rotate-180")} />
        )}
      </button>
      {expanded && disclosure.summary && (
        <div className="px-2 pb-1.5 text-[9px] text-muted-foreground/70 border-t border-border/50 pt-1 leading-relaxed">
          {disclosure.summary}
        </div>
      )}
    </div>
  );
}

// ── Document Card ──────────────────────────────────────────────────

function DocumentCard({ doc }: { doc: DocumentBlock }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = doc.content.split("\n").length;

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden text-[10px] w-full">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-amber-500/10 transition-colors"
      >
        <FileText className="h-3 w-3 text-amber-400 flex-shrink-0" />
        <span className="flex-1 font-medium text-foreground text-left">{doc.title}</span>
        <span className="text-[9px] text-muted-foreground/50 mr-1">{lineCount} lines</span>
        <ChevronDown className={cn("h-2.5 w-2.5 flex-shrink-0 transition-transform text-muted-foreground/50", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 text-[10px] text-muted-foreground leading-relaxed whitespace-pre-wrap border-t border-amber-500/10 pt-2 max-h-[200px] overflow-y-auto">
          {doc.content}
        </div>
      )}
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        isUser ? "items-end self-end max-w-[88%]" : "items-start self-start w-full"
      )}
    >
      {/* Tool call disclosures — shown above assistant message */}
      {!isUser && message.toolCallDisclosures && message.toolCallDisclosures.length > 0 && (
        <div className="flex flex-col gap-0.5 w-full">
          {message.toolCallDisclosures.map((d) => (
            <ToolDisclosure key={d.id} disclosure={d} />
          ))}
        </div>
      )}

      {/* Document card */}
      {!isUser && message.document && (
        <div className="w-full">
          <DocumentCard doc={message.document} />
        </div>
      )}

      {/* Image thumbnail for user messages with attached image */}
      {isUser && message.imageUrl && (
        <div className="rounded-lg overflow-hidden border border-border max-w-[180px]">
          <img
            src={message.imageUrl}
            alt="Attached"
            className="w-full h-auto object-cover block"
            style={{ maxHeight: 160 }}
          />
        </div>
      )}

      {/* Message bubble — only when has content */}
      {(message.content || message.isStreaming) && (
        <div
          className={cn(
            "rounded-xl px-2.5 py-1.5 text-[11px] leading-relaxed",
            isUser
              ? "bg-blue-600 text-white rounded-br-sm"
              : "bg-muted text-foreground rounded-bl-sm max-w-full"
          )}
        >
          {message.content ? (
            isUser ? (
              message.content
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{children}</ol>,
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  code: ({ children }) => <code className="bg-black/20 rounded px-1 py-0.5 text-[10px] font-mono">{children}</code>,
                  h1: ({ children }) => <h1 className="font-semibold text-sm mb-1">{children}</h1>,
                  h2: ({ children }) => <h2 className="font-semibold text-xs mb-1">{children}</h2>,
                  h3: ({ children }) => <h3 className="font-semibold text-[11px] mb-0.5">{children}</h3>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            )
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking...
            </span>
          )}
        </div>
      )}

    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [showTemplates, setShowSkills] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [llmModel, setLlmModel] = useState(DEFAULT_LLM_MODEL);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [videoModel, setVideoModel] = useState(DEFAULT_VIDEO_MODEL);
  const [pendingAttachment, setPendingAttachment] = useState<{ url: string; type: "video" | "image"; name: string; transcript?: string; transcribing?: boolean } | null>(null);
  const [transcriptionProgress, setTranscriptionProgress] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);

  const { currentOrganization } = useAuth();

  // Cleanup transcription polling on unmount
  useEffect(() => {
    return () => { transcriptionAbortRef.current?.abort(); };
  }, []);

  const {
    state,
    dispatch,
    addScene,
    removeScene,
    updateScene,
    updateSettings,
    setTitle,
    setVoiceover,
    setMusic,
    setRemotionCode,
    chatUploads,
    addChatUpload,
    updateChatUpload,
    captureFrameRef,
    triggerFirstSave,
  } = useVideoEditor();

  const { messages, isLoading, sendMessage, clearMessages } = useEditorChat({
    addScene,
    removeScene,
    updateScene,
    updateSettings,
    setTitle,
    setVoiceover,
    setMusic,
    setRemotionCode,
    addChatUpload,
    getScenes: () => state.project.scenes,
    getProject: () => state.project,
    getChatUploads: () => chatUploads,
  });

  // Stable ref for org id to avoid callback dependency churn
  const orgIdRef = useRef(currentOrganization?.id);
  orgIdRef.current = currentOrganization?.id;

  // Capture current video frame and attach as image
  const handleCaptureFrame = useCallback(async () => {
    if (!currentOrganization?.id || !captureFrameRef.current) return;
    setIsCapturing(true);
    try {
      const canvas = await captureFrameRef.current();
      if (!canvas) throw new Error("Could not capture frame");

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Canvas toBlob failed")), "image/jpeg", 0.92);
      });

      const path = `video-editor/${currentOrganization.id}/${Date.now()}_frame.jpg`;
      const { error } = await supabase.storage
        .from("content-media")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from("content-media").getPublicUrl(path);
      addChatUpload({ url: publicUrl, type: "image", name: "frame-capture.jpg" });
      setPendingAttachment({ url: publicUrl, type: "image", name: "frame-capture.jpg" });
    } catch (err: any) {
      toast.error("Frame capture failed", { description: err.message });
    } finally {
      setIsCapturing(false);
    }
  }, [currentOrganization, captureFrameRef]);

  // Handle file attachment from chat
  const handleAttachFile = useCallback(async (files: FileList) => {
    if (!orgIdRef.current || files.length === 0) return;
    const file = files[0];
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    if (!isVideo && !isImage) {
      toast.error("Only video and image files are supported");
      return;
    }

    setIsUploading(true);
    try {
      const ext = file.name.split(".").pop() || "mp4";
      const path = `video-editor/${orgIdRef.current}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;

      const { error } = await supabase.storage
        .from("content-media")
        .upload(path, file, { contentType: file.type });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from("content-media").getPublicUrl(path);
      const asset = { url: publicUrl, type: (isVideo ? "video" : "image") as "video" | "image", name: file.name };

      // Add all uploads to chatUploads so the AI knows about every asset
      addChatUpload({ ...asset, transcriptionState: isVideo ? "loading" : undefined });
      setPendingAttachment({ ...asset, transcribing: isVideo });

      // Auto-transcribe videos via Whisper (server-side wait)
      if (isVideo) {
        transcriptionAbortRef.current?.abort();
        const controller = new AbortController();
        transcriptionAbortRef.current = controller;

        setTranscriptionProgress("Starting Whisper transcription...");

        // Track elapsed time for UI
        const startTime = Date.now();
        const progressTimer = setInterval(() => {
          if (controller.signal.aborted) { clearInterval(progressTimer); return; }
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          setTranscriptionProgress(`Transcribing audio... ${elapsed}s`);
        }, 1000);

        // Single call - edge function waits for Replicate to finish
        supabase.functions.invoke("transcribe-video-editor", {
          body: { video_url: publicUrl, organization_id: orgIdRef.current },
        }).then(({ data, error: fnError }) => {
          clearInterval(progressTimer);
          if (controller.signal.aborted) return;

          if (fnError || data?.error || data?.status === "failed") {
            updateChatUpload(publicUrl, { transcriptionState: "error" });
            setPendingAttachment((prev) => prev ? { ...prev, transcribing: false } : prev);
            setTranscriptionProgress(null);
            toast.error("Transcription failed", { description: data?.error || fnError?.message });
            return;
          }

          updateChatUpload(publicUrl, { transcriptionState: "done" });
          setVoiceover({ url: publicUrl, word_timestamps: data.word_timestamps, script: data.transcript, source: "uploaded" });
          setPendingAttachment((prev) => prev?.url === publicUrl ? { ...prev, transcript: data.transcript, transcribing: false } : prev);
          setTranscriptionProgress(null);
          toast.success("Video transcribed successfully");
        });
      }
    } catch (err: any) {
      toast.error("Upload failed", { description: err.message });
    } finally {
      setIsUploading(false);
    }
  }, [addChatUpload, updateChatUpload]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Show templates dropdown when user types "/"
  useEffect(() => {
    if (input === "/" || (input.startsWith("/") && input.length < 15)) {
      setShowSkills(true);
    } else {
      setShowSkills(false);
    }
  }, [input]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && !pendingAttachment) || isLoading) return;

    let messageText = input.trim();
    let imageUrl: string | undefined;

    if (pendingAttachment) {
      if (pendingAttachment.type === "image") {
        // Pass image as vision input — the edge function will build a multimodal message
        imageUrl = pendingAttachment.url;
        // Include any user text; if empty, use a default prompt
        if (!messageText) messageText = "Animate this image into a video.";
      } else {
        // Video attachment: embed transcript info in text
        const transcriptNote = pendingAttachment.transcript
          ? `\nTranscript: "${pendingAttachment.transcript}"`
          : "";
        messageText = `${messageText ? messageText + "\n\n" : ""}[Attached video: ${pendingAttachment.name}]\nURL: ${pendingAttachment.url}${transcriptNote}`;
      }
    }

    // If this is a brand-new unsaved project, create the DB row + job first
    if (triggerFirstSave && !state.project.id) {
      try {
        const newProject = await triggerFirstSave();
        dispatch({ type: "SET_PROJECT", project: newProject });
      } catch (err) {
        console.error("[ChatPanel] Failed to create project:", err);
        return;
      }
    }

    sendMessage(messageText, imageUrl, { llmModel, imageModel, videoModel });
    setInput("");
    setShowSkills(false);
    setPendingAttachment(null);
  }, [input, pendingAttachment, isLoading, sendMessage, triggerFirstSave, state.project.id, dispatch, llmModel, imageModel, videoModel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { setShowSkills(false); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleSuggestion = useCallback(
    (suggestion: string) => {
      sendMessage(`Make a video about: ${suggestion}`, undefined, { llmModel, imageModel, videoModel });
    },
    [sendMessage, llmModel, imageModel, videoModel]
  );

  const handleTemplate = useCallback((template: Template) => {
    setInput(template.prompt);
    setShowTemplates(false);
    textareaRef.current?.focus();
  }, []);

  const templateQuery = input.startsWith("/") ? input.slice(1).toLowerCase() : "";
  const filteredTemplates = templateQuery
    ? TEMPLATES.filter(
        (t) =>
          t.command.slice(1).startsWith(templateQuery) ||
          t.label.toLowerCase().includes(templateQuery)
      )
    : TEMPLATES;

  return (
    <div className="flex flex-col h-full">
      {/* API key status banner */}
      <ApiKeyBanner />

      {/* Transcription progress banner */}
      {(isUploading || transcriptionProgress) && (
        <div className="border-b border-amber-500/20 bg-amber-500/5">
          <div className="px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-shrink-0">
                <Mic className="h-4 w-4 text-amber-400" />
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-foreground">
                  {isUploading ? "Uploading video..." : "Extracting audio with Whisper AI"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {isUploading
                    ? "Uploading to storage"
                    : transcriptionProgress || "Preparing transcription..."}
                </p>
              </div>
              <Loader2 className="h-4 w-4 animate-spin text-amber-400 flex-shrink-0" />
            </div>
            <div className="flex gap-1">
              <div className={`h-1 flex-1 rounded-full transition-colors duration-500 ${isUploading || transcriptionProgress ? "bg-amber-400" : "bg-muted"}`} />
              <div className={`h-1 flex-1 rounded-full transition-colors duration-500 ${transcriptionProgress && !isUploading ? "bg-amber-400" : "bg-muted"}`} />
              <div className="h-1 flex-1 rounded-full bg-muted" />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground/60">
              <span>Upload</span>
              <span>Transcribe</span>
              <span>Ready</span>
            </div>
          </div>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-2 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="flex flex-col items-center gap-1.5">
              <Sparkles className="h-7 w-7 text-muted-foreground/20" />
              <p className="text-xs text-muted-foreground font-medium">
                Describe your video idea
              </p>
              <p className="text-[10px] text-muted-foreground/60">
                AI researches, scripts, finds media, adds music
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSuggestion(s)}
                  className="px-2 py-0.5 rounded-full text-[10px] border border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border px-2.5 py-2 space-y-1.5 relative">
        <div className="flex items-center justify-between gap-1.5">
          {/* Model pickers */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <div className="flex items-center gap-1 min-w-0">
              <Sparkles className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <Select value={llmModel} onValueChange={setLlmModel}>
                <SelectTrigger className="h-6 text-[10px] w-auto min-w-[90px] max-w-[130px] border-border/50 bg-transparent px-1.5 gap-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LLM_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-[11px]">
                      {m.name}{m.recommended ? " *" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1 min-w-0">
              <Image className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <Select value={imageModel} onValueChange={setImageModel}>
                <SelectTrigger className="h-6 text-[10px] w-auto min-w-[90px] max-w-[120px] border-border/50 bg-transparent px-1.5 gap-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-[11px]">
                      {m.name}{m.recommended ? " *" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1 min-w-0">
              <Film className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <Select value={videoModel} onValueChange={setVideoModel}>
                <SelectTrigger className="h-6 text-[10px] w-auto min-w-[80px] max-w-[110px] border-border/50 bg-transparent px-1.5 gap-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIDEO_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-[11px]">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Clear chat */}
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors flex-shrink-0"
            >
              <Trash2 className="h-2.5 w-2.5" />
              Clear
            </button>
          )}
        </div>

        {/* Templates dropdown */}
        {showTemplates && filteredTemplates.length > 0 && (
          <div className="absolute bottom-full left-2.5 right-2.5 mb-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-10 max-h-[280px] overflow-y-auto">
            <div className="px-2 py-1 border-b border-border flex items-center gap-1.5 sticky top-0 bg-popover">
              <Zap className="h-3 w-3 text-amber-400" />
              <span className="text-[10px] font-medium text-muted-foreground">Templates</span>
            </div>
            {filteredTemplates.map((template) => (
              <button
                key={template.command}
                onClick={() => handleTemplate(template)}
                className="w-full text-left px-2 py-1.5 hover:bg-muted transition-colors flex items-start gap-2 border-b border-border/50 last:border-0"
              >
                <span className="text-[10px] font-mono text-primary font-medium mt-0.5 flex-shrink-0 w-14">
                  {template.command}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium text-foreground leading-tight">{template.label}</p>
                  <p className="text-[9px] text-muted-foreground leading-tight">{template.description}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pending attachment preview */}
        {pendingAttachment && (
          <div className="flex flex-col gap-0.5 px-2 py-1.5 rounded-md bg-muted border border-border text-[10px]">
            <div className="flex items-center gap-1.5">
              {pendingAttachment.type === "video" ? (
                <Film className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              ) : (
                <Image className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              )}
              <span className="flex-1 truncate text-foreground">{pendingAttachment.name}</span>
              <button
                onClick={() => setPendingAttachment(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Remove attachment"
              >
                <XCircle className="h-3 w-3" />
              </button>
            </div>
            {pendingAttachment.transcribing && (
              <div className="flex items-center gap-1 text-[9px] text-amber-400/80 pl-0.5">
                <Loader2 className="h-2.5 w-2.5 animate-spin flex-shrink-0" />
                Transcribing - see progress above
              </div>
            )}
            {!pendingAttachment.transcribing && pendingAttachment.transcript && (
              <div className="flex items-center gap-1 text-[9px] text-emerald-400/80 pl-0.5">
                <CheckCircle2 className="h-2.5 w-2.5 flex-shrink-0" />
                Transcript ready - AI will use it
              </div>
            )}
          </div>
        )}

        <div className="flex gap-1.5 items-end">
          {/* Screenshot current frame button */}
          <button
            onClick={handleCaptureFrame}
            disabled={isLoading || isCapturing || !captureFrameRef.current}
            className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-md border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Capture current frame and send to AI"
          >
            {isCapturing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || isUploading}
            className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-md border border-border bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Attach image or video"
          >
            {isUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Paperclip className="h-3.5 w-3.5" />
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,image/*"
            className="hidden"
            onChange={(e) => e.target.files && handleAttachFile(e.target.files)}
          />

          <div className="flex-1 relative">
            <Textarea
              ref={textareaRef}
              placeholder="Describe your video or type / for templates..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="text-xs min-h-[80px] max-h-[200px] resize-none pr-7"
              rows={3}
              disabled={isLoading}
            />
            {!input && (
              <button
                onClick={() => { setInput("/"); textareaRef.current?.focus(); }}
                className="absolute right-2 bottom-2 text-[9px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                title="Type / for skills"
              >
                <Zap className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            variant="cta"
            size="icon"
            className="h-9 w-9 flex-shrink-0"
            onClick={handleSend}
            disabled={isLoading || isUploading || (!input.trim() && !pendingAttachment)}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
