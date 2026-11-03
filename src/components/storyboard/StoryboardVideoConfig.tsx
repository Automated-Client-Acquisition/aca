import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  Layers,
  Film,
  Move,
  Music,
  Volume2,
  Subtitles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CAPTION_STYLE_TEMPLATES } from '@/data/captionStyleTemplates';
import type { TransitionType } from '@/hooks/useVideoEditor';

// ── Types ──────────────────────────────────────────────────────────────────

export type CameraMoveDefault =
  | 'ken_burns_slow'
  | 'ken_burns_fast'
  | 'punch_zoom'
  | 'pan_left'
  | 'pan_right'
  | 'tilt_up'
  | 'tilt_down'
  | 'static';

export interface StoryboardVideoConfigValues {
  transitionStyle: TransitionType;
  cameraMoveDefault: CameraMoveDefault;
  backgroundMusicUrl: string;
  backgroundMusicVolume: number;
  subtitleStyle: string;
}

interface StoryboardVideoConfigProps {
  value: StoryboardVideoConfigValues;
  onChange: (value: StoryboardVideoConfigValues) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const TRANSITION_OPTIONS: { value: TransitionType; label: string; icon: string }[] = [
  { value: 'cut', label: 'Cut', icon: '|' },
  { value: 'crossfade', label: 'Crossfade', icon: 'X' },
  { value: 'slide_left', label: 'Slide Left', icon: '<' },
  { value: 'slide_up', label: 'Slide Up', icon: '^' },
  { value: 'zoom', label: 'Zoom', icon: 'Z' },
];

const CAMERA_MOVE_OPTIONS: { value: CameraMoveDefault; label: string; description: string }[] = [
  { value: 'ken_burns_slow', label: 'Ken Burns (Slow)', description: 'Gentle slow zoom and pan' },
  { value: 'ken_burns_fast', label: 'Ken Burns (Fast)', description: 'Faster zoom and pan for energy' },
  { value: 'punch_zoom', label: 'Punch Zoom', description: 'Quick zoom-in on key moments' },
  { value: 'pan_left', label: 'Pan Left', description: 'Horizontal left pan' },
  { value: 'pan_right', label: 'Pan Right', description: 'Horizontal right pan' },
  { value: 'tilt_up', label: 'Tilt Up', description: 'Vertical upward movement' },
  { value: 'tilt_down', label: 'Tilt Down', description: 'Vertical downward movement' },
  { value: 'static', label: 'Static', description: 'No camera movement' },
];

// ── Component ──────────────────────────────────────────────────────────────

export function StoryboardVideoConfig({
  value,
  onChange,
}: StoryboardVideoConfigProps) {
  const update = (patch: Partial<StoryboardVideoConfigValues>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="space-y-6">
      {/* Transition Style */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-cta" />
          Default Transition
        </Label>
        <div className="grid grid-cols-5 gap-1.5">
          {TRANSITION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update({ transitionStyle: opt.value })}
              className={cn(
                'flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all',
                value.transitionStyle === opt.value
                  ? 'border-cta bg-cta/10 dark:bg-cta/5'
                  : 'border-border hover:border-cta/50',
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-md flex items-center justify-center text-sm font-bold',
                  value.transitionStyle === opt.value
                    ? 'bg-cta/20 text-cta'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {opt.icon}
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium',
                  value.transitionStyle === opt.value ? 'text-cta' : 'text-muted-foreground',
                )}
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Camera Move Default */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Move className="h-4 w-4 text-cta" />
          Default Camera Move
        </Label>
        <div className="grid grid-cols-2 gap-1.5">
          {CAMERA_MOVE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update({ cameraMoveDefault: opt.value })}
              className={cn(
                'flex items-center gap-2 p-2 rounded-lg border-2 transition-all text-left',
                value.cameraMoveDefault === opt.value
                  ? 'border-cta bg-cta/5 dark:bg-cta/5'
                  : 'border-border hover:border-cta/50',
              )}
            >
              <Film
                className={cn(
                  'h-4 w-4 flex-shrink-0',
                  value.cameraMoveDefault === opt.value ? 'text-cta' : 'text-muted-foreground',
                )}
              />
              <div className="min-w-0">
                <span
                  className={cn(
                    'text-xs font-medium block',
                    value.cameraMoveDefault === opt.value ? 'text-foreground' : 'text-foreground',
                  )}
                >
                  {opt.label}
                </span>
                <span className="text-[10px] text-muted-foreground">{opt.description}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Background Music URL */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Music className="h-4 w-4 text-cta" />
          Background Music URL
        </Label>
        <Input
          placeholder="https://example.com/ambient-music.mp3"
          value={value.backgroundMusicUrl}
          onChange={(e) => update({ backgroundMusicUrl: e.target.value })}
          className="focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Direct URL to an audio file. Leave blank for no background music.
        </p>
      </div>

      {/* Background Music Volume */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-cta" />
            Music Volume
          </Label>
          <span className="text-sm font-medium tabular-nums">
            {Math.round(value.backgroundMusicVolume * 100)}%
          </span>
        </div>
        <Slider
          value={[value.backgroundMusicVolume]}
          onValueChange={([v]) => update({ backgroundMusicVolume: v })}
          min={0}
          max={1}
          step={0.05}
          disabled={!value.backgroundMusicUrl}
        />
      </div>

      {/* Subtitle Style */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Subtitles className="h-4 w-4 text-cta" />
          Subtitle Style
        </Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {CAPTION_STYLE_TEMPLATES.map((tmpl) => {
            const isSelected = value.subtitleStyle === tmpl.id;
            return (
              <button
                key={tmpl.id}
                onClick={() => update({ subtitleStyle: tmpl.id })}
                className={cn(
                  'group relative flex flex-col rounded-lg border-2 transition-all overflow-hidden',
                  isSelected
                    ? 'border-cta bg-cta/5 dark:bg-cta/5'
                    : 'border-border hover:border-cta/50',
                )}
              >
                {/* Visual preview */}
                <div
                  className="h-14 flex items-end justify-center pb-2 relative"
                  style={{ backgroundColor: tmpl.preview.previewBg }}
                >
                  {tmpl.preview.hasTextBg && (
                    <div
                      className="absolute bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded"
                      style={{ backgroundColor: tmpl.preview.textBgColor }}
                    />
                  )}
                  <div className="relative z-10 flex items-baseline gap-1">
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: tmpl.preview.textColor }}
                    >
                      The quick
                    </span>
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: tmpl.preview.highlightColor }}
                    >
                      brown
                    </span>
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: tmpl.preview.textColor }}
                    >
                      fox
                    </span>
                  </div>
                </div>

                {/* Label */}
                <div className="p-1.5 text-center">
                  <span className="text-[10px] font-medium">{tmpl.name}</span>
                  {isSelected && (
                    <Badge variant="secondary" className="text-[8px] ml-1 px-1 py-0">
                      Selected
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
