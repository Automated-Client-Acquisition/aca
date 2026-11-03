import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Camera,
  Sparkles,
  Plus,
  Trash2,
  Gauge,
  Wind,
  Sun,
} from 'lucide-react';
import type { Scene, HighlightEffect } from '@/hooks/useVideoEditor';

interface EffectsPanelProps {
  scene: Scene;
  onSceneChange: (patch: Partial<Scene>) => void;
}

const CAMERA_MOVES = [
  { value: 'hold', label: 'Hold (Static)' },
  { value: 'ken_burns_slow', label: 'Ken Burns (Slow)' },
  { value: 'ken_burns_fast', label: 'Ken Burns (Fast)' },
  { value: 'punch_zoom', label: 'Punch Zoom' },
  { value: 'pan_left', label: 'Pan Left' },
  { value: 'pan_right', label: 'Pan Right' },
  { value: 'pan_down', label: 'Pan Down' },
  { value: 'zoom_out_reveal', label: 'Zoom Out Reveal' },
  { value: 'shake', label: 'Shake' },
  { value: 'tilt_3d', label: 'Tilt 3D' },
  { value: 'snap_to', label: 'Snap To' },
];

const HIGHLIGHT_TYPES: { value: HighlightEffect['type']; label: string }[] = [
  { value: 'red_circle', label: 'Red Circle' },
  { value: 'underline_draw', label: 'Underline Draw' },
  { value: 'blur_except', label: 'Blur Except' },
  { value: 'glow_pulse', label: 'Glow Pulse' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'fake_cursor_click', label: 'Fake Cursor Click' },
  { value: 'magnify', label: 'Magnify' },
];

const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function EffectsPanel({ scene, onSceneChange }: EffectsPanelProps) {
  const highlights = scene.highlights ?? [];

  const addHighlight = () => {
    const newHighlight: HighlightEffect = {
      type: 'red_circle',
      x: 50,
      y: 50,
      startFrame: 0,
      durationInFrames: 30,
    };
    onSceneChange({ highlights: [...highlights, newHighlight] });
  };

  const updateHighlight = (index: number, patch: Partial<HighlightEffect>) => {
    const updated = highlights.map((h, i) => (i === index ? { ...h, ...patch } : h));
    onSceneChange({ highlights: updated });
  };

  const removeHighlight = (index: number) => {
    onSceneChange({ highlights: highlights.filter((_, i) => i !== index) });
  };

  const speedIndex = SPEED_STEPS.indexOf(scene.speed ?? 1);
  const currentSpeedIdx = speedIndex >= 0 ? speedIndex : 2;

  return (
    <div className="space-y-5">
      {/* Camera Move */}
      <div className="space-y-2">
        <Label className="text-xs flex items-center gap-1.5">
          <Camera className="h-3 w-3" />
          Camera Move
        </Label>
        <Select
          value={scene.cameraMove || 'hold'}
          onValueChange={(val) => onSceneChange({ cameraMove: val })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAMERA_MOVES.map((cm) => (
              <SelectItem key={cm.value} value={cm.value}>
                {cm.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Highlight Effects */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Highlight Effects
          </Label>
          <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={addHighlight}>
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>

        {highlights.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">No highlight effects.</p>
        )}

        <div className="space-y-2">
          {highlights.map((h, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-border p-2.5 space-y-2 bg-muted/20 dark:bg-muted/10"
            >
              <div className="flex items-center gap-2">
                <Select
                  value={h.type}
                  onValueChange={(val) =>
                    updateHighlight(idx, { type: val as HighlightEffect['type'] })
                  }
                >
                  <SelectTrigger className="h-7 text-[10px] flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HIGHLIGHT_TYPES.map((ht) => (
                      <SelectItem key={ht.value} value={ht.value}>
                        {ht.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => removeHighlight(idx)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">X</Label>
                  <Input
                    type="number"
                    value={h.x}
                    onChange={(e) => updateHighlight(idx, { x: Number(e.target.value) })}
                    className="h-6 text-[10px] px-1.5"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Y</Label>
                  <Input
                    type="number"
                    value={h.y}
                    onChange={(e) => updateHighlight(idx, { y: Number(e.target.value) })}
                    className="h-6 text-[10px] px-1.5"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Start</Label>
                  <Input
                    type="number"
                    value={h.startFrame}
                    onChange={(e) => updateHighlight(idx, { startFrame: Number(e.target.value) })}
                    className="h-6 text-[10px] px-1.5"
                    min={0}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Dur.</Label>
                  <Input
                    type="number"
                    value={h.durationInFrames}
                    onChange={(e) =>
                      updateHighlight(idx, { durationInFrames: Number(e.target.value) })
                    }
                    className="h-6 text-[10px] px-1.5"
                    min={1}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Motion Blur */}
      <div className="flex items-center justify-between">
        <Label className="text-xs flex items-center gap-1.5">
          <Wind className="h-3 w-3" />
          Motion Blur
        </Label>
        <Switch
          checked={scene.motionBlur ?? false}
          onCheckedChange={(checked) => onSceneChange({ motionBlur: checked })}
        />
      </div>

      {/* Light Leak */}
      <div className="flex items-center justify-between">
        <Label className="text-xs flex items-center gap-1.5">
          <Sun className="h-3 w-3" />
          Light Leak at Transition
        </Label>
        <Switch
          checked={scene.transitionToNext != null}
          onCheckedChange={(checked) =>
            onSceneChange({ transitionToNext: checked ? 'crossfade' : null })
          }
        />
      </div>

      {/* Speed */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs flex items-center gap-1.5">
            <Gauge className="h-3 w-3" />
            Speed
          </Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {scene.speed ?? 1}x
          </span>
        </div>
        <Slider
          min={0}
          max={SPEED_STEPS.length - 1}
          step={1}
          value={[currentSpeedIdx]}
          onValueChange={([v]) => onSceneChange({ speed: SPEED_STEPS[v] })}
        />
        <div className="flex justify-between text-[9px] text-muted-foreground">
          {SPEED_STEPS.map((s) => (
            <span key={s}>{s}x</span>
          ))}
        </div>
      </div>
    </div>
  );
}
