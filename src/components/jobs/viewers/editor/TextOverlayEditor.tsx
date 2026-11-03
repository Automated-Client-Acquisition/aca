import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Type, MoveHorizontal, MoveVertical, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TextOverlay } from '@/hooks/useVideoEditor';

interface TextOverlayEditorProps {
  overlays: TextOverlay[];
  onAdd: (overlay: TextOverlay) => void;
  onUpdate: (id: string, patch: Partial<TextOverlay>) => void;
  onRemove: (id: string) => void;
  fps: number;
  totalDurationInFrames: number;
}

const COLOR_PRESETS = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Black', value: '#000000' },
  { label: 'Gold', value: '#FFD700' },
  { label: 'Red', value: '#EF4444' },
  { label: 'Blue', value: '#3B82F6' },
  { label: 'Green', value: '#22C55E' },
];

const FONT_SIZE_OPTIONS = [
  { label: 'Small', value: 24 },
  { label: 'Medium', value: 36 },
  { label: 'Large', value: 48 },
  { label: 'XL', value: 64 },
  { label: 'XXL', value: 80 },
];

export function TextOverlayEditor({
  overlays,
  onAdd,
  onUpdate,
  onRemove,
  fps,
  totalDurationInFrames,
}: TextOverlayEditorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleAddOverlay = () => {
    const id = `text-${Date.now()}`;
    onAdd({
      id,
      text: 'New Text',
      startFrame: 0,
      durationInFrames: Math.min(fps * 3, totalDurationInFrames), // 3 seconds or total
      x: 50,
      y: 80,
      fontSize: 36,
      color: '#FFFFFF',
      fontWeight: 'bold',
    });
    setExpandedId(id);
  };

  const formatTime = (frames: number) => {
    const sec = frames / fps;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Type className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Text Overlays</span>
          {overlays.length > 0 && (
            <span className="text-xs text-muted-foreground">({overlays.length})</span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleAddOverlay}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Text
        </Button>
      </div>

      {overlays.length === 0 && (
        <div className="text-center py-4 text-sm text-muted-foreground border border-dashed border-border rounded-md">
          No text overlays yet. Click "Add Text" to create one.
        </div>
      )}

      <div className="space-y-2">
        {overlays.map((overlay) => {
          const isExpanded = expandedId === overlay.id;

          return (
            <div
              key={overlay.id}
              className={cn(
                'rounded-lg border border-border transition-all',
                isExpanded ? 'bg-muted/30 dark:bg-muted/20' : 'bg-background hover:bg-muted/20',
              )}
            >
              {/* Header row */}
              <button
                className="w-full flex items-center gap-3 p-2.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : overlay.id)}
              >
                <div
                  className="w-4 h-4 rounded-sm flex-shrink-0 border border-border"
                  style={{ backgroundColor: overlay.color }}
                />
                <span className="flex-1 text-sm font-medium truncate">{overlay.text}</span>
                <span className="text-[10px] text-muted-foreground">
                  {formatTime(overlay.startFrame)} - {formatTime(overlay.startFrame + overlay.durationInFrames)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(overlay.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </button>

              {/* Expanded editor */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                  {/* Text */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Text Content</Label>
                    <Input
                      value={overlay.text}
                      onChange={(e) => onUpdate(overlay.id, { text: e.target.value })}
                      className="h-8 text-sm"
                      placeholder="Enter text..."
                    />
                  </div>

                  {/* Position */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1">
                        <MoveHorizontal className="h-3 w-3" />
                        X Position
                      </Label>
                      <Slider
                        value={[overlay.x]}
                        onValueChange={([v]) => onUpdate(overlay.id, { x: v })}
                        min={0}
                        max={100}
                        step={1}
                      />
                      <span className="text-[10px] text-muted-foreground">{overlay.x}%</span>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1">
                        <MoveVertical className="h-3 w-3" />
                        Y Position
                      </Label>
                      <Slider
                        value={[overlay.y]}
                        onValueChange={([v]) => onUpdate(overlay.id, { y: v })}
                        min={0}
                        max={100}
                        step={1}
                      />
                      <span className="text-[10px] text-muted-foreground">{overlay.y}%</span>
                    </div>
                  </div>

                  {/* Timing */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Start (frames)
                      </Label>
                      <Slider
                        value={[overlay.startFrame]}
                        onValueChange={([v]) => onUpdate(overlay.id, { startFrame: v })}
                        min={0}
                        max={Math.max(0, totalDurationInFrames - overlay.durationInFrames)}
                        step={1}
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {formatTime(overlay.startFrame)}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Duration (frames)</Label>
                      <Slider
                        value={[overlay.durationInFrames]}
                        onValueChange={([v]) => onUpdate(overlay.id, { durationInFrames: v })}
                        min={fps * 0.5} // Minimum 0.5s
                        max={totalDurationInFrames - overlay.startFrame}
                        step={1}
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {formatTime(overlay.durationInFrames)}
                      </span>
                    </div>
                  </div>

                  {/* Style row */}
                  <div className="grid grid-cols-3 gap-3">
                    {/* Font size */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Size</Label>
                      <Select
                        value={String(overlay.fontSize)}
                        onValueChange={(v) => onUpdate(overlay.id, { fontSize: Number(v) })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FONT_SIZE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>
                              {opt.label} ({opt.value}px)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Font weight */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Weight</Label>
                      <Select
                        value={overlay.fontWeight}
                        onValueChange={(v) =>
                          onUpdate(overlay.id, { fontWeight: v as 'normal' | 'bold' })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="bold">Bold</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Color */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Color</Label>
                      <div className="flex gap-1 flex-wrap">
                        {COLOR_PRESETS.map((c) => (
                          <button
                            key={c.value}
                            className={cn(
                              'w-5 h-5 rounded-full border-2 transition-transform',
                              overlay.color === c.value
                                ? 'border-cta scale-110'
                                : 'border-border hover:scale-105',
                            )}
                            style={{ backgroundColor: c.value }}
                            onClick={() => onUpdate(overlay.id, { color: c.value })}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
