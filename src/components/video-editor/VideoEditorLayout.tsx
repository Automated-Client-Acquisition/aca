import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AssetBrowser } from "./AssetBrowser";
import { AssetsWindow } from "./AssetsWindow";
import { VideoPreview } from "./VideoPreview";
import { PropertyEditor } from "./PropertyEditor";
import { Timeline } from "./Timeline";
import { ExportDialog } from "./ExportDialog";
import { useVideoEditor } from "./context/VideoEditorContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Download,
  Undo2,
  Redo2,
  Loader2,
  PanelLeftClose,
  PanelRightClose,
  PanelLeft,
  PanelRight,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AspectRatio } from "@/types/videoEditor";

const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string; short: string; icon: string }[] = [
  { value: "portrait", label: "Portrait (9:16)", short: "9:16", icon: "▯" },
  { value: "landscape", label: "Landscape (16:9)", short: "16:9", icon: "▭" },
  { value: "square", label: "Square (1:1)", short: "1:1", icon: "□" },
];

export function VideoEditorLayout() {
  const navigate = useNavigate();
  const { state, setTitle, undo, redo, canUndo, canRedo, updateSettings, setRemotionCode } = useVideoEditor();
  const [exportOpen, setExportOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const isWidePanel = state.activePanel === "chat" || state.activePanel === "code";

  // Derive the effective aspect ratio from remotion_code @aspect metadata (if present)
  const codeAspect = useMemo(() => {
    const code = state.project.remotion_code;
    if (!code?.trim()) return null;
    const match = code.match(/\/\/\s*@aspect\s+(portrait|landscape|square)/i);
    return match ? match[1].toLowerCase() as AspectRatio : null;
  }, [state.project.remotion_code]);

  // Sync project settings from code metadata when remotion_code is loaded
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    if (hasSyncedRef.current) return;
    if (codeAspect && codeAspect !== state.project.settings.aspect_ratio) {
      hasSyncedRef.current = true;
      updateSettings({ aspect_ratio: codeAspect });
    }
  }, [codeAspect, state.project.settings.aspect_ratio, updateSettings]);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTitle(e.target.value);
    },
    [setTitle]
  );

  // When changing aspect ratio, also update @aspect metadata in remotion_code if it exists
  const handleAspectRatioChange = useCallback(
    (value: AspectRatio) => {
      updateSettings({ aspect_ratio: value });
      if (state.project.remotion_code?.trim()) {
        const code = state.project.remotion_code;
        const updated = code.replace(
          /\/\/\s*@aspect\s+(portrait|landscape|square)/i,
          `// @aspect ${value}`
        );
        if (updated !== code) {
          setRemotionCode(updated);
        }
      }
    },
    [updateSettings, setRemotionCode, state.project.remotion_code]
  );

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="flex items-center gap-1 px-2 h-11 border-b border-border bg-card flex-shrink-0">
        {/* Left group: back + title */}
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 flex-shrink-0"
              onClick={() => navigate("/jobs")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back to Jobs</TooltipContent>
        </Tooltip>

        <div className="h-5 w-px bg-border mx-1" />

        <Input
          value={state.project.title}
          onChange={handleTitleChange}
          className="h-7 text-sm font-medium w-44 border-transparent hover:border-border focus:border-primary bg-transparent px-1.5"
        />

        <div className="h-5 w-px bg-border mx-1" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={undo}
                disabled={!canUndo}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Undo</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={redo}
                disabled={!canRedo}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Redo</TooltipContent>
          </Tooltip>
        </div>

        {/* Aspect ratio picker */}
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 bg-muted/30">
          {ASPECT_RATIO_OPTIONS.map(({ value, label, short }) => (
            <Tooltip key={value} delayDuration={400}>
              <TooltipTrigger asChild>
                <Button
                  variant={state.project.settings.aspect_ratio === value ? "default" : "ghost"}
                  size="sm"
                  className="h-6 px-2 text-[10px] font-medium"
                  onClick={() => handleAspectRatioChange(value)}
                >
                  {short}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Save status */}
        {state.isSaving && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Saving...</span>
          </div>
        )}

        {!state.isSaving && !state.isDirty && state.project.id && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-500/70 mr-2">
            <CheckCircle2 className="h-3 w-3" />
            <span>Saved</span>
          </div>
        )}

        <div className="h-5 w-px bg-border mx-1" />

        {/* Panel toggles */}
        <div className="flex items-center gap-0.5">
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLeftOpen(!leftOpen)}>
                {leftOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeft className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{leftOpen ? "Hide" : "Show"} Assets</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRightOpen(!rightOpen)}>
                {rightOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRight className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{rightOpen ? "Hide" : "Show"} Properties</TooltipContent>
          </Tooltip>
        </div>

        <div className="h-5 w-px bg-border mx-1" />

        <Button variant="cta" size="sm" className="h-7 text-xs px-3" onClick={() => setExportOpen(true)}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export
        </Button>
      </header>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {leftOpen && (
          <div
            className={cn(
              "border-r border-border bg-card flex-shrink-0 overflow-hidden flex flex-col h-full",
              isWidePanel ? "w-[560px]" : "w-[300px]"
            )}
          >
            <AssetBrowser />
          </div>
        )}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0">
            <VideoPreview />
          </div>
          <Timeline />
        </div>
        {rightOpen && (
          <div className="w-[280px] border-l border-border bg-card flex-shrink-0 overflow-hidden flex flex-col">
            <div className="h-[220px] flex-shrink-0 border-b border-border">
              <AssetsWindow />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <PropertyEditor />
            </div>
          </div>
        )}
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
