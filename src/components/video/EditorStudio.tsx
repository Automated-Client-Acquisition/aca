/**
 * EditorStudio — Track-based video editor for compositions using EditorState.
 *
 * 3-column layout: Track list | Preview player | Properties panel
 *
 * Used by MultiStageDetailPanel when the composition has an EditorState
 * (track-based model) as opposed to the shot-based VideoStudio.
 */

import { useState, useCallback, useMemo } from "react";
import { Player } from "@remotion/player";
import { EditorComposition } from "@/remotion/compositions/EditorComposition";
import type { EditorState, Track, Item } from "@/lib/editorState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  X, Save, Play, Undo2, Redo2, Eye, EyeOff,
  Volume2, VolumeX, Layers, Film, Image as ImageIcon,
  Type, Music, Subtitles, Square,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EditorStudioProps {
  initialState: EditorState;
  onSave?: (state: EditorState) => void;
  onRender?: (state: EditorState) => void;
  onClose: () => void;
}

const ITEM_TYPE_ICONS: Record<string, typeof Film> = {
  video: Film,
  image: ImageIcon,
  text: Type,
  solid: Square,
  audio: Music,
  captions: Subtitles,
  overlay: Layers,
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  video: 'bg-blue-500/20 border-blue-500/40',
  image: 'bg-green-500/20 border-green-500/40',
  text: 'bg-yellow-500/20 border-yellow-500/40',
  solid: 'bg-gray-500/20 border-gray-500/40',
  audio: 'bg-purple-500/20 border-purple-500/40',
  captions: 'bg-orange-500/20 border-orange-500/40',
  overlay: 'bg-pink-500/20 border-pink-500/40',
};

export function EditorStudio({
  initialState,
  onSave,
  onRender,
  onClose,
}: EditorStudioProps) {
  const [state, setState] = useState<EditorState>(initialState);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<EditorState[]>([]);
  const [redoStack, setRedoStack] = useState<EditorState[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [...prev.slice(-49), state]);
    setRedoStack([]);
  }, [state]);

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, state]);
      setState(last);
      return prev.slice(0, -1);
    });
  }, [state]);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setUndoStack((u) => [...u, state]);
      setState(last);
      return prev.slice(0, -1);
    });
  }, [state]);

  const toggleTrackVisibility = useCallback((trackIndex: number) => {
    pushUndo();
    setState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t, i) =>
        i === trackIndex ? { ...t, hidden: !t.hidden } : t,
      ),
    }));
  }, [pushUndo]);

  const toggleTrackMute = useCallback((trackIndex: number) => {
    pushUndo();
    setState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t, i) =>
        i === trackIndex ? { ...t, muted: !t.muted } : t,
      ),
    }));
  }, [pushUndo]);

  const updateItem = useCallback((trackIndex: number, itemId: string, patch: Partial<Item>) => {
    pushUndo();
    setState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t, ti) =>
        ti === trackIndex
          ? { ...t, items: t.items.map((item) => (item.id === itemId ? { ...item, ...patch } as Item : item)) }
          : t,
      ),
    }));
  }, [pushUndo]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    for (const track of state.tracks) {
      const item = track.items.find((i) => i.id === selectedItemId);
      if (item) return item;
    }
    return null;
  }, [state.tracks, selectedItemId]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave(state);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, state]);

  const handleRender = useCallback(async () => {
    if (!onRender) return;
    setIsRendering(true);
    try {
      await onRender(state);
    } finally {
      setIsRendering(false);
    }
  }, [onRender, state]);

  const totalDurationSec = state.durationInFrames / state.fps;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Track Editor</h2>
          <Badge variant="outline" className="text-xs">
            {state.tracks.length} tracks
          </Badge>
          <Badge variant="outline" className="text-xs">
            {state.width}x{state.height} @ {state.fps}fps
          </Badge>
          <Badge variant="outline" className="text-xs">
            {totalDurationSec.toFixed(1)}s
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={undo}
            disabled={undoStack.length === 0}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={redo}
            disabled={redoStack.length === 0}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          {onSave && (
            <Button variant="outline" size="sm" onClick={handleSave} disabled={isSaving}>
              <Save className="h-4 w-4 mr-1" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          )}
          {onRender && (
            <Button variant="cta" size="sm" onClick={handleRender} disabled={isRendering}>
              <Play className="h-4 w-4 mr-1" />
              {isRendering ? 'Rendering...' : 'Render'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body: 3-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Track list */}
        <div className="w-64 border-r bg-card flex flex-col">
          <div className="px-3 py-2 border-b">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Tracks
            </h3>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {state.tracks.map((track, trackIndex) => (
                <div
                  key={track.name + trackIndex}
                  className={cn(
                    "rounded-md border p-2 cursor-pointer transition-colors",
                    selectedTrackIndex === trackIndex
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:bg-accent/50",
                  )}
                  onClick={() => {
                    setSelectedTrackIndex(trackIndex);
                    setSelectedItemId(null);
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium truncate">{track.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        className="p-0.5 rounded hover:bg-accent"
                        onClick={(e) => { e.stopPropagation(); toggleTrackVisibility(trackIndex); }}
                      >
                        {track.hidden ? (
                          <EyeOff className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        className="p-0.5 rounded hover:bg-accent"
                        onClick={(e) => { e.stopPropagation(); toggleTrackMute(trackIndex); }}
                      >
                        {track.muted ? (
                          <VolumeX className="h-3 w-3 text-muted-foreground" />
                        ) : (
                          <Volume2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {track.items.map((item) => {
                      const Icon = ITEM_TYPE_ICONS[item.type] || Layers;
                      return (
                        <button
                          key={item.id}
                          className={cn(
                            "flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border",
                            ITEM_TYPE_COLORS[item.type] || 'bg-accent',
                            selectedItemId === item.id && "ring-1 ring-primary",
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTrackIndex(trackIndex);
                            setSelectedItemId(item.id);
                          }}
                        >
                          <Icon className="h-3 w-3" />
                          <span className="truncate max-w-[80px]">
                            {item.type === 'text' ? (item as any).text?.slice(0, 12) || 'Text' : item.type}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Center: Preview */}
        <div className="flex-1 flex items-center justify-center bg-black/90 p-4">
          <div
            style={{
              width: state.width > state.height ? '100%' : 'auto',
              height: state.height >= state.width ? '100%' : 'auto',
              maxWidth: '100%',
              maxHeight: '100%',
              aspectRatio: `${state.width}/${state.height}`,
            }}
          >
            <Player
              component={EditorComposition}
              inputProps={state}
              durationInFrames={state.durationInFrames}
              fps={state.fps}
              compositionWidth={state.width}
              compositionHeight={state.height}
              style={{ width: '100%', height: '100%' }}
              controls
              autoPlay={false}
            />
          </div>
        </div>

        {/* Right: Properties panel */}
        <div className="w-72 border-l bg-card flex flex-col">
          <div className="px-3 py-2 border-b">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Properties
            </h3>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3">
              {selectedItem ? (
                <ItemProperties
                  item={selectedItem}
                  trackIndex={selectedTrackIndex}
                  assets={state.assets}
                  onUpdate={(patch) => updateItem(selectedTrackIndex, selectedItem.id, patch)}
                />
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Select an item to edit its properties
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

interface ItemPropertiesProps {
  item: Item;
  trackIndex: number;
  assets: EditorState['assets'];
  onUpdate: (patch: Partial<Item>) => void;
}

function ItemProperties({ item, assets, onUpdate }: ItemPropertiesProps) {
  const asset = 'assetId' in item
    ? assets.find((a) => a.id === (item as any).assetId)
    : null;

  return (
    <div className="space-y-4">
      <div>
        <Badge className="mb-2">{item.type}</Badge>
        {asset && (
          <p className="text-xs text-muted-foreground truncate">
            Asset: {asset.name}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Start Frame</Label>
        <Input
          type="number"
          value={item.from}
          onChange={(e) => onUpdate({ from: parseInt(e.target.value) || 0 })}
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Duration (frames)</Label>
        <Input
          type="number"
          value={item.durationInFrames}
          onChange={(e) => onUpdate({ durationInFrames: parseInt(e.target.value) || 30 })}
          className="h-8 text-xs"
        />
      </div>

      {item.type === 'video' && (
        <>
          <div className="space-y-2">
            <Label className="text-xs">Volume</Label>
            <Slider
              value={[(item as any).volume * 100]}
              onValueChange={([v]) => onUpdate({ volume: v / 100 } as any)}
              min={0}
              max={100}
              step={1}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Playback Rate</Label>
            <Input
              type="number"
              value={(item as any).playbackRate || 1}
              onChange={(e) => onUpdate({ playbackRate: parseFloat(e.target.value) || 1 } as any)}
              className="h-8 text-xs"
              step={0.1}
              min={0.1}
              max={4}
            />
          </div>
        </>
      )}

      {item.type === 'text' && (
        <>
          <div className="space-y-2">
            <Label className="text-xs">Text</Label>
            <Input
              value={(item as any).text || ''}
              onChange={(e) => onUpdate({ text: e.target.value } as any)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Font Size</Label>
            <Input
              type="number"
              value={(item as any).fontSize || 48}
              onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) || 48 } as any)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Color</Label>
            <Input
              type="color"
              value={(item as any).color || '#FFFFFF'}
              onChange={(e) => onUpdate({ color: e.target.value } as any)}
              className="h-8"
            />
          </div>
        </>
      )}

      {item.type === 'audio' && (
        <div className="space-y-2">
          <Label className="text-xs">Volume</Label>
          <Slider
            value={[(item as any).volume * 100]}
            onValueChange={([v]) => onUpdate({ volume: v / 100 } as any)}
            min={0}
            max={100}
            step={1}
          />
        </div>
      )}

      {item.type === 'overlay' && (
        <div className="space-y-2">
          <Label className="text-xs">Intensity</Label>
          <Slider
            value={[(item as any).intensity * 100]}
            onValueChange={([v]) => onUpdate({ intensity: v / 100 } as any)}
            min={0}
            max={100}
            step={1}
          />
        </div>
      )}

      {(item.type === 'image' || item.type === 'video' || item.type === 'solid') && (
        <>
          <Separator />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">X</Label>
              <Input
                type="number"
                value={(item as any).x || 0}
                onChange={(e) => onUpdate({ x: parseInt(e.target.value) || 0 } as any)}
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Y</Label>
              <Input
                type="number"
                value={(item as any).y || 0}
                onChange={(e) => onUpdate({ y: parseInt(e.target.value) || 0 } as any)}
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Width</Label>
              <Input
                type="number"
                value={(item as any).width || 0}
                onChange={(e) => onUpdate({ width: parseInt(e.target.value) || 0 } as any)}
                className="h-7 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Height</Label>
              <Input
                type="number"
                value={(item as any).height || 0}
                onChange={(e) => onUpdate({ height: parseInt(e.target.value) || 0 } as any)}
                className="h-7 text-xs"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
