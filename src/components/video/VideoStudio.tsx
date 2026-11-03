/**
 * VideoStudio — Unified shot/scene editor for the `video` pipeline.
 *
 * 3-column layout: Shot list | Preview player | Properties panel
 *
 * Used by MultiStageDetailPanel when opening the editor for the
 * unified video pipeline's director stage output.
 */

import { useState, useMemo, useCallback } from "react";
import { Player } from "@remotion/player";
import { ShotPreviewComposition } from "@/remotion/presenter/ShotPreviewComposition";
import { DEFAULT_BRAND } from "@/remotion/presenter/types";
import type { Shot, ScreenshotData, BrandConfig } from "@/remotion/presenter/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  X, GripVertical, Plus, Trash2, Film, Image as ImageIcon,
  Type, BarChart3, Quote, List, Palette,
  Undo2, Redo2, Save, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LAYOUT_OPTIONS = [
  { value: 'screenshot_fullscreen', label: 'Full Frame', icon: Layers },
  { value: 'scene_image', label: 'Scene Image', icon: ImageIcon },
  { value: 'video_clip', label: 'Video Clip', icon: Film },
  { value: 'text_card', label: 'Text Card', icon: Type },
  { value: 'stat_card', label: 'Stat Card', icon: BarChart3 },
  { value: 'quote_card', label: 'Quote Card', icon: Quote },
  { value: 'list_reveal', label: 'List Reveal', icon: List },
  { value: 'gradient_title', label: 'Gradient Title', icon: Palette },
];

const CAMERA_MOVES = [
  { value: 'ken_burns_slow', label: 'Ken Burns' },
  { value: 'punch_zoom', label: 'Punch Zoom' },
  { value: 'pan_left', label: 'Pan Left' },
  { value: 'pan_right', label: 'Pan Right' },
  { value: 'pan_down', label: 'Pan Down' },
  { value: 'zoom_out_reveal', label: 'Zoom Out' },
  { value: 'shake', label: 'Shake' },
  { value: 'hold', label: 'Hold' },
];

const TRANSITIONS = [
  { value: 'cut_hard', label: 'Hard Cut' },
  { value: 'slide_left', label: 'Slide Left' },
  { value: 'snap_cut', label: 'Snap Cut' },
  { value: 'fade', label: 'Fade' },
  { value: 'crossfade', label: 'Crossfade' },
  { value: 'whoosh', label: 'Whoosh' },
  { value: 'slam_zoom', label: 'Slam Zoom' },
];

const SOUND_EFFECTS = [
  { value: '_none', label: 'None' },
  { value: 'whoosh', label: 'Whoosh' },
  { value: 'pop', label: 'Pop' },
  { value: 'click', label: 'Click' },
  { value: 'ding', label: 'Ding' },
  { value: 'boom', label: 'Boom' },
];

interface VideoStudioProps {
  initialShots: Shot[];
  screenshots: ScreenshotData[];
  sourceVideoUrl?: string | null;
  brand?: BrandConfig;
  orientation?: 'portrait' | 'landscape';
  onSave?: (shots: Shot[]) => void;
  onClose: () => void;
}

export function VideoStudio({
  initialShots,
  screenshots,
  sourceVideoUrl,
  brand = DEFAULT_BRAND,
  orientation = 'landscape',
  onSave,
  onClose,
}: VideoStudioProps) {
  const [shots, setShots] = useState<Shot[]>(initialShots);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [undoStack, setUndoStack] = useState<Shot[][]>([]);
  const [redoStack, setRedoStack] = useState<Shot[][]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const selectedShot = shots[selectedIndex] || null;
  const isPortrait = orientation === 'portrait';
  const playerWidth = isPortrait ? 360 : 640;
  const playerHeight = isPortrait ? 640 : 360;

  // Push current state to undo stack
  const pushUndo = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-49), shots]);
    setRedoStack([]);
  }, [shots]);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(r => [...r, shots]);
    setUndoStack(u => u.slice(0, -1));
    setShots(prev);
  }, [undoStack, shots]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(u => [...u, shots]);
    setRedoStack(r => r.slice(0, -1));
    setShots(next);
  }, [redoStack, shots]);

  // Update a single shot
  const updateShot = useCallback((index: number, updates: Partial<Shot>) => {
    pushUndo();
    setShots(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  }, [pushUndo]);

  // Remove a shot
  const removeShot = useCallback((index: number) => {
    if (shots.length <= 1) return;
    pushUndo();
    setShots(prev => prev.filter((_, i) => i !== index));
    if (selectedIndex >= shots.length - 1) {
      setSelectedIndex(Math.max(0, shots.length - 2));
    }
  }, [shots, selectedIndex, pushUndo]);

  // Add a new shot after the selected one
  const addShot = useCallback(() => {
    pushUndo();
    const newShot: Shot = {
      layout: 'text_card' as any,
      narration: '',
      duration: 4,
      camera: 'hold' as any,
      transition_in: 'cut_hard' as any,
    };
    const insertAt = selectedIndex + 1;
    setShots(prev => [...prev.slice(0, insertAt), newShot, ...prev.slice(insertAt)]);
    setSelectedIndex(insertAt);
  }, [selectedIndex, pushUndo]);

  // Drag-and-drop reorder
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === targetIndex) return;
    pushUndo();
    setShots(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(dragIndex, 1);
      updated.splice(targetIndex, 0, moved);
      return updated;
    });
    setDragIndex(targetIndex);
    setSelectedIndex(targetIndex);
  }, [dragIndex, pushUndo]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
  }, []);

  const totalDuration = useMemo(() => shots.reduce((sum, s) => sum + (s.duration || 0), 0), [shots]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Video Studio</h2>
          <Badge variant="secondary">{shots.length} shots</Badge>
          <span className="text-sm text-muted-foreground">{Math.round(totalDuration)}s</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={undo} disabled={undoStack.length === 0}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={redo} disabled={redoStack.length === 0}>
            <Redo2 className="h-4 w-4" />
          </Button>
          {onSave && (
            <Button variant="cta" size="sm" onClick={() => onSave(shots)}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main 3-column layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Shot list */}
        <div className="w-64 border-r flex flex-col">
          <div className="p-2 border-b flex items-center justify-between">
            <span className="text-sm font-medium">Shots</span>
            <Button variant="ghost" size="sm" onClick={addShot}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {shots.map((shot, i) => {
                const screenshotUrl = shot.screenshot_index != null
                  ? screenshots[shot.screenshot_index]?.url
                  : shot.scene_image_url || null;
                const isSelected = i === selectedIndex;

                return (
                  <div
                    key={i}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragEnd={handleDragEnd}
                    onClick={() => setSelectedIndex(i)}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded cursor-pointer group",
                      isSelected ? "bg-cta/10 border border-cta/30" : "hover:bg-muted/50",
                      dragIndex === i && "opacity-50"
                    )}
                  >
                    <GripVertical className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 cursor-grab" />
                    <div className="w-12 h-8 rounded overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                      {screenshotUrl ? (
                        <img src={screenshotUrl} alt="" className="w-full h-full object-cover" />
                      ) : shot.layout === 'video_clip' ? (
                        <Film className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <Type className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">Shot {i + 1}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{shot.duration}s · {(shot.layout as string)?.replace(/_/g, ' ')}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Center: Preview */}
        <div className="flex-1 flex flex-col items-center justify-center bg-black/5 min-w-0">
          {selectedShot && (
            <div className="p-4">
              <Player
                component={ShotPreviewComposition}
                inputProps={{
                  shot: selectedShot,
                  screenshots,
                  brand,
                  sourceVideoUrl,
                }}
                durationInFrames={Math.max(1, Math.round((selectedShot.duration || 4) * 30))}
                fps={30}
                compositionWidth={isPortrait ? 1080 : 1920}
                compositionHeight={isPortrait ? 1920 : 1080}
                style={{ width: playerWidth, height: playerHeight }}
                controls
                loop
                autoPlay={false}
              />
              <p className="text-center text-xs text-muted-foreground mt-2">
                Shot {selectedIndex + 1} of {shots.length}
              </p>
            </div>
          )}
        </div>

        {/* Right: Properties */}
        <div className="w-72 border-l flex flex-col">
          <div className="p-3 border-b">
            <span className="text-sm font-medium">Properties</span>
          </div>
          {selectedShot ? (
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-4">
                {/* Layout */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Layout</Label>
                  <Select
                    value={selectedShot.layout}
                    onValueChange={(val) => updateShot(selectedIndex, { layout: val as any })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LAYOUT_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Duration */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Duration ({selectedShot.duration}s)</Label>
                  <Slider
                    min={1}
                    max={30}
                    step={0.5}
                    value={[selectedShot.duration || 4]}
                    onValueChange={([val]) => updateShot(selectedIndex, { duration: val })}
                  />
                </div>

                {/* Camera Move */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Camera Move</Label>
                  <Select
                    value={selectedShot.camera || 'ken_burns_slow'}
                    onValueChange={(val) => updateShot(selectedIndex, { camera: val as any })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAMERA_MOVES.map(opt => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Transition */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Transition In</Label>
                  <Select
                    value={selectedShot.transition_in || 'cut_hard'}
                    onValueChange={(val) => updateShot(selectedIndex, { transition_in: val as any })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSITIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                {/* Narration */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Narration</Label>
                  <Textarea
                    value={selectedShot.narration || ''}
                    onChange={(e) => updateShot(selectedIndex, { narration: e.target.value })}
                    rows={3}
                    className="text-xs"
                    placeholder="Shot narration..."
                  />
                </div>

                {/* Text Overlay */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Text Overlay</Label>
                  <Input
                    value={selectedShot.text_overlay || ''}
                    onChange={(e) => updateShot(selectedIndex, { text_overlay: e.target.value })}
                    className="h-8 text-xs"
                    placeholder="On-screen text..."
                  />
                </div>

                {/* Sound Effect */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Sound Effect</Label>
                  <Select
                    value={selectedShot.sound_effect || '_none'}
                    onValueChange={(val) => updateShot(selectedIndex, { sound_effect: val === '_none' ? undefined : val as any })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOUND_EFFECTS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Video Clip specific fields */}
                {selectedShot.layout === 'video_clip' && (
                  <>
                    <Separator />
                    <div className="space-y-1.5">
                      <Label className="text-xs">Source Start (s)</Label>
                      <Input
                        type="number"
                        step={0.1}
                        value={selectedShot.source_start ?? 0}
                        onChange={(e) => updateShot(selectedIndex, { source_start: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Source End (s)</Label>
                      <Input
                        type="number"
                        step={0.1}
                        value={selectedShot.source_end ?? 0}
                        onChange={(e) => updateShot(selectedIndex, { source_end: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Speed ({selectedShot.speed ?? 1}x)</Label>
                      <Slider
                        min={0.25}
                        max={4}
                        step={0.25}
                        value={[selectedShot.speed ?? 1]}
                        onValueChange={([val]) => updateShot(selectedIndex, { speed: val })}
                      />
                    </div>
                  </>
                )}

                <Separator />

                {/* Delete shot */}
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => removeShot(selectedIndex)}
                  disabled={shots.length <= 1}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove Shot
                </Button>
              </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a shot to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
