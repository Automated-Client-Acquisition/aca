import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Mic,
  Subtitles,
  Monitor,
  Smartphone,
  Music,
  Sparkles,
  Crown,
  VolumeX,
  Film,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

export type SourceType = 'url' | 'upload' | 'prompt_only';
export type VoiceType = 'heygen_avatar' | 'voiceover' | 'none';
export type BRollStyle = 'stock' | 'ai_generated';
export type LipSyncProvider = 'elevenlabs' | 'heygen' | 'sync_labs';
export type SubtitleStyle = 'tiktok_bounce' | 'big_center' | 'karaoke' | 'minimal';
export type Orientation = 'portrait' | 'landscape';
export type TemplateType =
  | 'product_review'
  | 'competitor_teardown'
  | 'feature_walkthrough'
  | 'news_commentary'
  | 'tutorial'
  | 'listicle'
  | 'landing_page_audit'
  | 'industry_analysis'
  | 'tool_comparison'
  | 'behind_the_scenes'
  | 'reaction'
  | 'explainer';

export interface PresenterVideoConfigValues {
  voiceType: VoiceType;
  bRollEnabled: boolean;
  bRollStyle: BRollStyle;
  subtitleStyle: SubtitleStyle;
  orientation: Orientation;
  backgroundMusicUrl?: string;
}

interface PresenterVideoConfigProps {
  value: PresenterVideoConfigValues;
  onChange: (value: PresenterVideoConfigValues) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const VOICE_OPTIONS: { value: VoiceType; label: string; description: string; icon: React.ElementType }[] = [
  { value: 'heygen_avatar', label: 'AI Avatar', description: 'HeyGen talking head', icon: Crown },
  { value: 'voiceover', label: 'Voice Over', description: 'Professional narration', icon: Mic },
  { value: 'none', label: 'No Voice', description: 'Text & captions only', icon: VolumeX },
];

const SUBTITLE_STYLES: { value: SubtitleStyle; label: string; preview: { color: string; animation: string } }[] = [
  { value: 'tiktok_bounce', label: 'TikTok Bounce', preview: { color: '#FF6B6B', animation: 'Bounce pop' } },
  { value: 'big_center', label: 'Big Center', preview: { color: '#FFFFFF', animation: 'Scale in' } },
  { value: 'karaoke', label: 'Karaoke', preview: { color: '#FFD700', animation: 'Word fill' } },
  { value: 'minimal', label: 'Minimal', preview: { color: '#E0E0E0', animation: 'Fade' } },
];

// ── Selector Card ──────────────────────────────────────────────────────────

function SelectorCard<T extends string>({
  value,
  selected,
  onSelect,
  label,
  description,
  icon: Icon,
}: {
  value: T;
  selected: boolean;
  onSelect: (v: T) => void;
  label: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'flex flex-col items-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all text-center',
        selected
          ? 'border-cta bg-cta/5 dark:bg-cta/5 shadow-sm shadow-cta/10'
          : 'border-border hover:border-cta/50 hover:bg-muted/30',
      )}
    >
      <div className={cn(
        'w-10 h-10 rounded-full flex items-center justify-center',
        selected ? 'bg-cta/15 text-cta' : 'bg-muted text-muted-foreground',
      )}>
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-[11px] text-muted-foreground leading-tight">{description}</span>
    </button>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function PresenterVideoConfig({
  value,
  onChange,
}: PresenterVideoConfigProps) {
  const update = (patch: Partial<PresenterVideoConfigValues>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="space-y-8">
      {/* ── Section 1: Voice & Presenter ───────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Mic className="h-4 w-4 text-cta" />
          Voice & Presenter
        </Label>
        <p className="text-xs text-muted-foreground">
          Pin a Library Character to set the voice and avatar.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {VOICE_OPTIONS.map((opt) => (
            <SelectorCard
              key={opt.value}
              value={opt.value}
              selected={value.voiceType === opt.value}
              onSelect={(v) => update({ voiceType: v })}
              label={opt.label}
              description={opt.description}
              icon={opt.icon}
            />
          ))}
        </div>
      </div>

      {/* ── Section 2: Enhancements ────────────────────────────────────── */}
      <div className="space-y-4">
        <Label className="text-sm font-semibold">Enhancements</Label>

        {/* B-Roll Toggle */}
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="space-y-0.5">
            <Label className="text-sm flex items-center gap-2">
              <Film className="h-4 w-4 text-muted-foreground" />
              B-Roll Footage
            </Label>
            <p className="text-xs text-muted-foreground">Auto-insert cutaway clips between scenes</p>
          </div>
          <Switch
            checked={value.bRollEnabled}
            onCheckedChange={(v) => update({ bRollEnabled: v })}
          />
        </div>

        {value.bRollEnabled && (
          <div className="pl-1 border-l-2 border-cta/30 ml-2">
            <div className="pl-3">
              <RadioGroup
                value={value.bRollStyle}
                onValueChange={(v) => update({ bRollStyle: v as BRollStyle })}
                className="grid grid-cols-2 gap-2"
              >
                <label className={cn(
                  'flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all',
                  value.bRollStyle === 'stock' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                )}>
                  <RadioGroupItem value="stock" className="sr-only" />
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-xs font-medium">Stock Footage</span>
                    <span className="text-[10px] text-muted-foreground block">From Pexels library</span>
                  </div>
                </label>
                <label className={cn(
                  'flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all',
                  value.bRollStyle === 'ai_generated' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                )}>
                  <RadioGroupItem value="ai_generated" className="sr-only" />
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <span className="text-xs font-medium">AI Generated</span>
                    <span className="text-[10px] text-muted-foreground block">AI-created imagery</span>
                  </div>
                </label>
              </RadioGroup>
            </div>
          </div>
        )}

        {/* Background Music */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-xs">
            <Music className="h-3.5 w-3.5 text-muted-foreground" />
            Background Music (optional)
          </Label>
          <Input
            placeholder="https://example.com/music.mp3"
            value={value.backgroundMusicUrl || ''}
            onChange={(e) => update({ backgroundMusicUrl: e.target.value || undefined })}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* ── Section 3: Output Style ───────────────────────────────────── */}
      <div className="space-y-4">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Subtitles className="h-4 w-4 text-cta" />
          Output Style
        </Label>

        {/* Subtitle Style */}
        <div className="space-y-2">
          <Label className="text-xs flex items-center gap-2">
            <Subtitles className="h-3.5 w-3.5 text-muted-foreground" />
            Subtitle Style
          </Label>
          <div className="grid grid-cols-4 gap-2">
            {SUBTITLE_STYLES.map((style) => (
              <button
                key={style.value}
                onClick={() => update({ subtitleStyle: style.value })}
                className={cn(
                  'flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all',
                  value.subtitleStyle === style.value ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                )}
              >
                <div className="w-full h-7 rounded bg-gray-900 flex items-end justify-center pb-0.5 relative overflow-hidden">
                  <span className="text-[7px] font-bold" style={{ color: style.preview.color }}>Sample</span>
                </div>
                <span className="text-[9px] font-medium">{style.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Orientation */}
        <div className="space-y-2">
          <Label className="text-xs">Orientation</Label>
          <RadioGroup
            value={value.orientation}
            onValueChange={(v) => update({ orientation: v as Orientation })}
            className="grid grid-cols-2 gap-2"
          >
            <label className={cn(
              'flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all',
              value.orientation === 'portrait' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
            )}>
              <RadioGroupItem value="portrait" className="sr-only" />
              <Smartphone className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-xs font-medium">Portrait</span>
                <span className="text-[10px] text-muted-foreground block">9:16</span>
              </div>
            </label>
            <label className={cn(
              'flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-all',
              value.orientation === 'landscape' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
            )}>
              <RadioGroupItem value="landscape" className="sr-only" />
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="text-xs font-medium">Landscape</span>
                <span className="text-[10px] text-muted-foreground block">16:9</span>
              </div>
            </label>
          </RadioGroup>
        </div>
      </div>
    </div>
  );
}
