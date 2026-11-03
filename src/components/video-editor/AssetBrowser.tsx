import { useVideoEditor } from "./context/VideoEditorContext";
import { ChatPanel } from "./panels/ChatPanel";
import { StockVideoPanel } from "./panels/StockVideoPanel";
import { AIImagePanel } from "./panels/AIImagePanel";
import { AIVideoPanel } from "./panels/AIVideoPanel";
import { UploadPanel } from "./panels/UploadPanel";
import { VoiceoverPanel } from "./panels/VoiceoverPanel";
import { MusicPanel } from "./panels/MusicPanel";
import { SoundEffectsPanel } from "./panels/SoundEffectsPanel";
import { CaptionsPanel } from "./panels/CaptionsPanel";
import { CodePanel } from "./panels/CodePanel";
import { SceneList } from "./SceneList";
import type { EditorPanel } from "@/types/videoEditor";
import { cn } from "@/lib/utils";
import {
  MessageSquareText,
  Layers,
  Search,
  Wand2,
  Film,
  Upload,
  Mic,
  Music,
  Volume2,
  Captions,
  Code2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const PANEL_CONFIG: { id: EditorPanel; label: string; icon: React.ReactNode }[] = [
  { id: "chat", label: "Chat", icon: <MessageSquareText className="h-4 w-4" /> },
  { id: "scenes", label: "Scenes", icon: <Layers className="h-4 w-4" /> },
  { id: "stock", label: "Stock", icon: <Search className="h-4 w-4" /> },
  { id: "ai_image", label: "AI Image", icon: <Wand2 className="h-4 w-4" /> },
  { id: "ai_video", label: "AI Video", icon: <Film className="h-4 w-4" /> },
  { id: "upload", label: "Upload", icon: <Upload className="h-4 w-4" /> },
  { id: "voiceover", label: "Voice", icon: <Mic className="h-4 w-4" /> },
  { id: "music", label: "Music", icon: <Music className="h-4 w-4" /> },
  { id: "sfx", label: "SFX", icon: <Volume2 className="h-4 w-4" /> },
  { id: "captions", label: "Captions", icon: <Captions className="h-4 w-4" /> },
  { id: "code", label: "Code", icon: <Code2 className="h-4 w-4" /> },
];

const PANEL_CONTENT: Partial<Record<EditorPanel, React.ReactNode>> = {
  chat: null, // ChatPanel is always mounted separately to preserve chat state
  scenes: <SceneList />,
  stock: <StockVideoPanel />,
  ai_image: <AIImagePanel />,
  ai_video: <AIVideoPanel />,
  upload: <UploadPanel />,
  voiceover: <VoiceoverPanel />,
  music: <MusicPanel />,
  sfx: <SoundEffectsPanel />,
  captions: <CaptionsPanel />,
  code: <CodePanel />,
};

export function AssetBrowser() {
  const { state, setPanel } = useVideoEditor();
  const activeLabel = PANEL_CONFIG.find((p) => p.id === state.activePanel)?.label ?? "Scenes";

  return (
    <div className="flex h-full">
      {/* Vertical icon rail */}
      <div className="flex flex-col items-center w-11 flex-shrink-0 border-r border-border bg-muted/30 py-1.5 gap-0.5">
        {PANEL_CONFIG.map(({ id, label, icon }) => (
          <Tooltip key={id} delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setPanel(id)}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-md transition-colors",
                  "text-muted-foreground hover:text-foreground hover:bg-accent",
                  state.activePanel === id &&
                    "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                )}
              >
                {icon}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              {label}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {state.activePanel !== "chat" && (
          <div className="px-3 py-2 border-b border-border flex-shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {activeLabel}
            </span>
          </div>
        )}
        {/* ChatPanel is always mounted to preserve conversation state */}
        <div className={cn("flex-1 min-h-0 overflow-hidden", state.activePanel !== "chat" && "hidden")}>
          <ChatPanel />
        </div>
        {state.activePanel !== "chat" && (
          <div className="flex-1 min-h-0 overflow-hidden">
            {PANEL_CONTENT[state.activePanel]}
          </div>
        )}
      </div>
    </div>
  );
}
