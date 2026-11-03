/**
 * UnifiedVideoConfig — Configuration UI for the unified `video` pipeline.
 *
 * Replaces PresenterVideoConfig, VideoRemixConfig, and StoryboardVideoConfig
 * with a single card-based UI with progressive disclosure.
 *
 * Sections:
 * 1. Source — Where does the content come from?
 * 2. Narration — How is the script created?
 * 3. Voice — How is it spoken?
 * 4. Visuals — AI images, B-roll, orientation, subtitles
 */

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Globe,
  Upload,
  ImageIcon,
  Wand2,
  Mic,
  Crown,
  VolumeX,
  Volume2,
  Subtitles,
  Monitor,
  Smartphone,
  Music,
  Film,
  Sparkles,
  ChevronDown,
  PenTool,
  Languages,
  Timer,
  Scissors,
  RefreshCw,
  Expand,
  MessageSquare,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  VideoConfig,
  VideoSource,
  NarrationMode,
  RewriteStyle,
  VoiceMode,
  ImageMode,
  BRollStyle,
  VideoOrientation,
} from '@/types/video';

interface UnifiedVideoConfigProps {
  value: VideoConfig;
  onChange: (value: VideoConfig) => void;
}

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

// ── Constants ──────────────────────────────────────────────────────────────

const SOURCE_OPTIONS: { value: VideoSource; label: string; description: string; icon: React.ElementType }[] = [
  { value: 'url', label: 'From URL', description: 'Web page screenshots', icon: Globe },
  { value: 'upload_video', label: 'From Video', description: 'Import existing video', icon: Upload },
  { value: 'upload_images', label: 'From Images', description: 'Uploaded visuals', icon: ImageIcon },
  { value: 'prompt_only', label: 'From Scratch', description: 'AI generates everything', icon: Wand2 },
];

const VOICE_OPTIONS: { value: VoiceMode; label: string; description: string; icon: React.ElementType }[] = [
  { value: 'voiceover', label: 'AI Voiceover', description: 'Professional narration', icon: Mic },
  { value: 'avatar', label: 'AI Avatar', description: 'Talking head with lip sync', icon: Crown },
  { value: 'keep_original', label: 'Keep Original', description: 'Use existing audio', icon: Volume2 },
  { value: 'none', label: 'No Voice', description: 'Music / silent', icon: VolumeX },
];

const REWRITE_STYLES: { value: RewriteStyle; label: string; description: string; icon: React.ElementType }[] = [
  { value: 'polish', label: 'Polish', description: 'Clean up, improve clarity', icon: Sparkles },
  { value: 'shorten', label: 'Shorten', description: 'Cut to 30-60s viral clip', icon: Scissors },
  { value: 'expand', label: 'Expand', description: 'Add detail and context', icon: Expand },
  { value: 'react', label: 'React', description: 'Commentary / reaction style', icon: MessageSquare },
  { value: 'translate', label: 'Translate', description: 'Different language', icon: Languages },
  { value: 'custom', label: 'Custom', description: 'Your own instructions', icon: PenTool },
];

const SUBTITLE_STYLES = [
  { value: 'tiktok_bounce', label: 'TikTok Bounce', color: '#FF6B6B' },
  { value: 'big_center', label: 'Big Center', color: '#FFFFFF' },
  { value: 'karaoke', label: 'Karaoke', color: '#FFD700' },
  { value: 'minimal', label: 'Minimal', color: '#E0E0E0' },
];

const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian',
  'Dutch', 'Russian', 'Japanese', 'Korean', 'Chinese', 'Arabic',
  'Hindi', 'Turkish', 'Polish', 'Swedish', 'Norwegian', 'Danish',
];

// ── Component ──────────────────────────────────────────────────────────────

export function UnifiedVideoConfig({ value, onChange }: UnifiedVideoConfigProps) {
  const update = (patch: Partial<VideoConfig>) => {
    onChange({ ...value, ...patch });
  };

  const isVideoSource = value.source === 'upload_video';

  return (
    <div className="space-y-8">
      {/* ── Section 1: Source ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Globe className="h-4 w-4 text-cta" />
          Source Material
        </Label>
        <p className="text-xs text-muted-foreground">
          Where does the content come from?
        </p>
        <div className="grid grid-cols-4 gap-3">
          {SOURCE_OPTIONS.map((opt) => (
            <SelectorCard
              key={opt.value}
              value={opt.value}
              selected={value.source === opt.value}
              onSelect={(v) => {
                const patch: Partial<VideoConfig> = { source: v };
                // Reset source-dependent fields
                if (v !== 'upload_video') {
                  if (value.narrationMode === 'rewrite') patch.narrationMode = 'generate';
                  if (value.voiceMode === 'keep_original') patch.voiceMode = 'voiceover';
                }
                update(patch);
              }}
              label={opt.label}
              description={opt.description}
              icon={opt.icon}
            />
          ))}
        </div>
      </div>

      {/* ── Section 2: Narration ──────────────────────────────────────── */}
      <div className="space-y-4">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <PenTool className="h-4 w-4 text-cta" />
          Narration
        </Label>

        {isVideoSource ? (
          <>
            <p className="text-xs text-muted-foreground">
              Since you're importing a video, choose how to handle the script.
            </p>
            <RadioGroup
              value={value.narrationMode}
              onValueChange={(v) => update({ narrationMode: v as NarrationMode })}
              className="grid grid-cols-2 gap-3"
            >
              <label className={cn(
                'flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all',
                value.narrationMode === 'generate' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
              )}>
                <RadioGroupItem value="generate" className="sr-only" />
                <Wand2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <span className="text-sm font-medium">Generate New</span>
                  <span className="text-[10px] text-muted-foreground block">AI writes fresh narration</span>
                </div>
              </label>
              <label className={cn(
                'flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all',
                value.narrationMode === 'rewrite' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
              )}>
                <RadioGroupItem value="rewrite" className="sr-only" />
                <RefreshCw className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <span className="text-sm font-medium">Rewrite Existing</span>
                  <span className="text-[10px] text-muted-foreground block">Transform the original script</span>
                </div>
              </label>
            </RadioGroup>

            {/* Rewrite style selector */}
            {value.narrationMode === 'rewrite' && (
              <div className="space-y-3 pl-1 border-l-2 border-cta/30 ml-2">
                <div className="pl-3">
                  <Label className="text-xs mb-2 block">Rewrite Style</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {REWRITE_STYLES.map((style) => (
                      <button
                        key={style.value}
                        type="button"
                        onClick={() => update({ rewriteStyle: style.value })}
                        className={cn(
                          'flex items-center gap-2 p-2 rounded-lg border-2 text-left transition-all',
                          value.rewriteStyle === style.value ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                        )}
                      >
                        <style.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div>
                          <span className="text-xs font-medium">{style.label}</span>
                          <span className="text-[9px] text-muted-foreground block">{style.description}</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Translate: language picker */}
                  {value.rewriteStyle === 'translate' && (
                    <div className="mt-3">
                      <Label className="text-xs mb-1 block">Target Language</Label>
                      <Select
                        value={value.targetLanguage || ''}
                        onValueChange={(v) => update({ targetLanguage: v })}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select language..." />
                        </SelectTrigger>
                        <SelectContent>
                          {LANGUAGES.map((lang) => (
                            <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Custom: instructions input */}
                  {value.rewriteStyle === 'custom' && (
                    <div className="mt-3">
                      <Label className="text-xs mb-1 block">Custom Instructions</Label>
                      <Input
                        placeholder="e.g., Rewrite the opening 15s to maximize retention..."
                        value={value.customRewriteInstructions || ''}
                        onChange={(e) => update({ customRewriteInstructions: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              AI will generate narration from the blueprint's master prompt.
            </p>
            {/* Duration slider */}
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-2">
                <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                Target Duration: {value.targetDuration || 60}s
              </Label>
              <Slider
                value={[value.targetDuration || 60]}
                onValueChange={([v]) => update({ targetDuration: v })}
                min={15}
                max={900}
                step={15}
                className="w-full"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>15s</span>
                <span>1m</span>
                <span>5m</span>
                <span>10m</span>
                <span>15m</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Section 3: Voice ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Mic className="h-4 w-4 text-cta" />
          Voice
        </Label>
        <p className="text-xs text-muted-foreground">
          Pin a Library Character to set voice and avatar settings.
        </p>
        <div className="grid grid-cols-4 gap-3">
          {VOICE_OPTIONS
            .filter((opt) => opt.value !== 'keep_original' || isVideoSource)
            .map((opt) => (
              <SelectorCard
                key={opt.value}
                value={opt.value}
                selected={value.voiceMode === opt.value}
                onSelect={(v) => update({ voiceMode: v })}
                label={opt.label}
                description={opt.description}
                icon={opt.icon}
              />
            ))}
        </div>

        {/* Avatar sub-options */}
        {value.voiceMode === 'avatar' && (
          <div className="space-y-3 pl-1 border-l-2 border-cta/30 ml-2">
            <div className="pl-3">
              <Label className="text-xs mb-2 block">Lip Sync Provider</Label>
              <Select
                value={value.lipSyncProvider || 'elevenlabs'}
                onValueChange={(v) => update({ lipSyncProvider: v as any })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="elevenlabs">ElevenLabs (Photo → Video)</SelectItem>
                  <SelectItem value="heygen">HeyGen (Avatar Templates)</SelectItem>
                  <SelectItem value="sync_labs">SyncLabs</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Avatar photo/ID is configured on the Library Character.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 4: Visuals (Collapsible) ─────────────────────────── */}
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="flex items-center gap-2 w-full group">
          <Settings2 className="h-4 w-4 text-cta" />
          <Label className="text-sm font-semibold cursor-pointer">Visual Settings</Label>
          <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto group-data-[state=open]:rotate-180 transition-transform" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 mt-4">
          {/* AI Images Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                AI-Generated Images
              </Label>
              <p className="text-xs text-muted-foreground">Generate scene images with AI</p>
            </div>
            <Switch
              checked={value.imageMode === 'ai_generated'}
              onCheckedChange={(v) => update({ imageMode: v ? 'ai_generated' : 'none' })}
            />
          </div>

          {/* B-Roll Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm flex items-center gap-2">
                <Film className="h-4 w-4 text-muted-foreground" />
                B-Roll Footage
              </Label>
              <p className="text-xs text-muted-foreground">Auto-insert cutaway clips</p>
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
                  value={value.bRollStyle || 'stock'}
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
                    (value.bRollStyle || 'stock') === 'ai_generated' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
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
                  type="button"
                  onClick={() => update({ subtitleStyle: style.value })}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all',
                    value.subtitleStyle === style.value ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                  )}
                >
                  <div className="w-full h-7 rounded bg-gray-900 flex items-end justify-center pb-0.5 relative overflow-hidden">
                    <span className="text-[7px] font-bold" style={{ color: style.color }}>Sample</span>
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
              onValueChange={(v) => update({ orientation: v as VideoOrientation })}
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
                  <span className="text-[10px] text-muted-foreground block">9:16 — TikTok, Reels, Shorts</span>
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
                  <span className="text-[10px] text-muted-foreground block">16:9 — YouTube, LinkedIn</span>
                </div>
              </label>
            </RadioGroup>
          </div>

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
            {value.backgroundMusicUrl && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">
                  Volume: {Math.round((value.backgroundMusicVolume ?? 0.15) * 100)}%
                </Label>
                <Slider
                  value={[value.backgroundMusicVolume ?? 0.15]}
                  onValueChange={([v]) => update({ backgroundMusicVolume: v })}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full"
                />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
