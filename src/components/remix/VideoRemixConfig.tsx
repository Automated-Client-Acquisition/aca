import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  User,
  Mic,
  Subtitles,
  Monitor,
  Smartphone,
  ImageIcon,
  Music,
  Upload,
  Sparkles,
  Crown,
  Zap,
  Volume2,
  Film,
  ChevronDown,
  Settings2,
  Globe,
  Wand2,
  Scissors,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  BRollStyle,
  LipSyncProvider,
  SubtitleStyle,
  Orientation,
  TemplateType,
} from '@/components/presenter/PresenterVideoConfig';

// ── Types ──────────────────────────────────────────────────────────────────

export type VisualStyle = 'enhance' | 'remix';
export type VoiceOption = 'new_voice' | 'keep_original' | 'avatar';

export interface VideoRemixConfigValues {
  // Visual style
  visualStyle: VisualStyle;

  // Voice settings
  voiceOption: VoiceOption;
  voiceId: string;
  avatarType: 'none' | 'photo' | 'heygen' | 'character';
  avatarPhotoUrl?: string;
  heygenAvatarId?: string;
  characterId?: string;
  lipSyncProvider: LipSyncProvider;

  // Enhancements
  bRollEnabled: boolean;
  bRollStyle: BRollStyle;
  subtitleStyle: SubtitleStyle;
  orientation: Orientation;
  backgroundMusicUrl?: string;

  // Production settings
  templateType: TemplateType;
  maxFrames: number;
}

interface VideoRemixConfigProps {
  value: VideoRemixConfigValues;
  onChange: (value: VideoRemixConfigValues) => void;
  characters?: Array<{ id: string; name: string; avatar_url?: string }>;
  heygenAvatars?: Array<{ avatar_id: string; avatar_name: string; preview_image_url?: string }>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const VISUAL_STYLE_OPTIONS: { value: VisualStyle; label: string; description: string; icon: React.ElementType }[] = [
  { value: 'enhance', label: 'Enhance', description: 'Light polish — keep the original flow, clean up with cuts & captions', icon: Wand2 },
  { value: 'remix', label: 'Remix', description: 'Full creative edit — AI re-orders, cuts freely, adds effects', icon: Scissors },
];

const VOICE_OPTIONS: { value: VoiceOption; label: string; description: string; icon: React.ElementType }[] = [
  { value: 'new_voice', label: 'New AI Voice', description: 'ElevenLabs TTS voiceover', icon: Mic },
  { value: 'keep_original', label: 'Keep Original', description: 'Preserve source audio', icon: Volume2 },
  { value: 'avatar', label: 'AI Avatar', description: 'Talking head + new voice', icon: Crown },
];

const SUBTITLE_STYLES: { value: SubtitleStyle; label: string; preview: { color: string } }[] = [
  { value: 'tiktok_bounce', label: 'TikTok Bounce', preview: { color: '#FF6B6B' } },
  { value: 'big_center', label: 'Big Center', preview: { color: '#FFFFFF' } },
  { value: 'karaoke', label: 'Karaoke', preview: { color: '#FFD700' } },
  { value: 'minimal', label: 'Minimal', preview: { color: '#E0E0E0' } },
];

const LIP_SYNC_PROVIDERS: { value: LipSyncProvider; label: string; badge: string; icon: React.ElementType }[] = [
  { value: 'elevenlabs', label: 'ElevenLabs', badge: 'Default', icon: Sparkles },
  { value: 'heygen', label: 'HeyGen', badge: 'Premium', icon: Crown },
  { value: 'sync_labs', label: 'Sync Labs', badge: 'Power User', icon: Zap },
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

export function VideoRemixConfig({
  value,
  onChange,
  characters = [],
  heygenAvatars = [],
}: VideoRemixConfigProps) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const update = (patch: Partial<VideoRemixConfigValues>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="space-y-8">
      {/* ── Section 0: Visual Style ─────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cta" />
          Editing Style
        </Label>
        <div className="grid grid-cols-2 gap-3">
          {VISUAL_STYLE_OPTIONS.map((opt) => (
            <SelectorCard
              key={opt.value}
              value={opt.value}
              selected={value.visualStyle === opt.value}
              onSelect={(v) => update({ visualStyle: v })}
              label={opt.label}
              description={opt.description}
              icon={opt.icon}
            />
          ))}
        </div>
      </div>

      {/* ── Section 1: Voice Option ─────────────────────────────────────── */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold flex items-center gap-2">
          <Mic className="h-4 w-4 text-cta" />
          Voice
        </Label>
        <div className="grid grid-cols-3 gap-3">
          {VOICE_OPTIONS.map((opt) => (
            <SelectorCard
              key={opt.value}
              value={opt.value}
              selected={value.voiceOption === opt.value}
              onSelect={(v) => {
                const patch: Partial<VideoRemixConfigValues> = { voiceOption: v };
                if (v === 'avatar') patch.avatarType = 'heygen';
                else patch.avatarType = 'none';
                update(patch);
              }}
              label={opt.label}
              description={opt.description}
              icon={opt.icon}
            />
          ))}
        </div>

        {/* Voice info + avatar config — shown for new_voice and avatar */}
        {value.voiceOption !== 'keep_original' && (
          <div className="pl-1 border-l-2 border-cta/30 ml-2 mt-3">
            <div className="pl-3 space-y-4">
              <div className="rounded-md border border-border/50 bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <Mic className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Voice is configured on your Character</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Pin a Library Character with a voice to set the voiceover voice.
                      If no character voice is set, the system default will be used.
                    </p>
                  </div>
                </div>
              </div>

              {/* Avatar config — only for avatar voice option */}
              {value.voiceOption === 'avatar' && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs">Avatar</Label>
                    <RadioGroup
                      value={value.avatarType}
                      onValueChange={(v) => update({ avatarType: v as 'none' | 'photo' | 'heygen' | 'character' })}
                      className="grid grid-cols-3 gap-2"
                    >
                      <label className={cn(
                        'flex flex-col items-center gap-1 p-2 rounded-lg border-2 cursor-pointer transition-all',
                        value.avatarType === 'heygen' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                      )}>
                        <RadioGroupItem value="heygen" className="sr-only" />
                        <Crown className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[10px]">HeyGen</span>
                      </label>
                      <label className={cn(
                        'flex flex-col items-center gap-1 p-2 rounded-lg border-2 cursor-pointer transition-all',
                        value.avatarType === 'photo' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                      )}>
                        <RadioGroupItem value="photo" className="sr-only" />
                        <Upload className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[10px]">Photo</span>
                      </label>
                      <label className={cn(
                        'flex flex-col items-center gap-1 p-2 rounded-lg border-2 cursor-pointer transition-all',
                        value.avatarType === 'character' ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                      )}>
                        <RadioGroupItem value="character" className="sr-only" />
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[10px]">Character</span>
                      </label>
                    </RadioGroup>

                    {value.avatarType === 'heygen' && heygenAvatars.length > 0 && (
                      <div className="grid grid-cols-4 gap-2">
                        {heygenAvatars.map((avatar) => (
                          <button
                            key={avatar.avatar_id}
                            onClick={() => update({ heygenAvatarId: avatar.avatar_id })}
                            className={cn(
                              'flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all',
                              value.heygenAvatarId === avatar.avatar_id ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                            )}
                          >
                            {avatar.preview_image_url ? (
                              <img src={avatar.preview_image_url} alt={avatar.avatar_name} className="w-10 h-10 rounded-full object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                                <User className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <span className="text-[10px] truncate w-full text-center">{avatar.avatar_name}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {value.avatarType === 'photo' && (
                      <div className="space-y-2">
                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) update({ avatarPhotoUrl: URL.createObjectURL(file) });
                          }}
                        />
                        {value.avatarPhotoUrl ? (
                          <div className="flex items-center gap-3">
                            <img src={value.avatarPhotoUrl} alt="Avatar" className="w-10 h-10 rounded-full object-cover border border-border" />
                            <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()}>Change</Button>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} className="gap-2">
                            <ImageIcon className="h-3.5 w-3.5" />
                            Upload Photo
                          </Button>
                        )}
                      </div>
                    )}

                    {value.avatarType === 'character' && characters.length > 0 && (
                      <Select value={value.characterId || ''} onValueChange={(v) => update({ characterId: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select a character..." />
                        </SelectTrigger>
                        <SelectContent>
                          {characters.map((char) => (
                            <SelectItem key={char.id} value={char.id}>
                              <div className="flex items-center gap-2">
                                {char.avatar_url ? (
                                  <img src={char.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                                ) : (
                                  <User className="h-4 w-4 text-muted-foreground" />
                                )}
                                {char.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Lip-Sync Provider</Label>
                    <RadioGroup
                      value={value.lipSyncProvider}
                      onValueChange={(v) => update({ lipSyncProvider: v as LipSyncProvider })}
                      className="grid grid-cols-3 gap-2"
                    >
                      {LIP_SYNC_PROVIDERS.map((provider) => {
                        const LspIcon = provider.icon;
                        return (
                          <label
                            key={provider.value}
                            className={cn(
                              'flex flex-col items-center gap-1 p-2 rounded-lg border-2 cursor-pointer transition-all text-center',
                              value.lipSyncProvider === provider.value ? 'border-cta bg-cta/5' : 'border-border hover:border-cta/50',
                            )}
                          >
                            <RadioGroupItem value={provider.value} className="sr-only" />
                            <LspIcon className="h-3.5 w-3.5" />
                            <span className="text-[10px] font-medium">{provider.label}</span>
                            <Badge variant={provider.value === 'elevenlabs' ? 'secondary' : 'outline'} className="text-[8px] px-1">
                              {provider.badge}
                            </Badge>
                          </label>
                        );
                      })}
                    </RadioGroup>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {value.voiceOption === 'keep_original' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground pl-2">
              Original audio is preserved. The rewritten script is used for captions and to guide the visual edit.
            </p>
            {value.visualStyle === 'remix' && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 ml-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-amber-500">Audio may not sync</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Remix mode re-orders and cuts segments freely, which can desync original audio.
                    Consider switching to <button type="button" className="underline text-cta" onClick={() => update({ voiceOption: 'new_voice' })}>New AI Voice</button> for best results.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Section 2: Advanced (Collapsible) ──────────────────────────── */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-between text-sm text-muted-foreground hover:text-foreground">
            <span className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Advanced Settings
            </span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          {/* B-Roll Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm flex items-center gap-2">
                <Film className="h-4 w-4 text-muted-foreground" />
                B-Roll Footage
              </Label>
              <p className="text-xs text-muted-foreground">Insert cutaway clips between scenes</p>
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

          {/* Max Frames */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Max Key Frames</Label>
              <span className="text-xs font-medium tabular-nums">{value.maxFrames}</span>
            </div>
            <Slider
              value={[value.maxFrames]}
              onValueChange={([v]) => update({ maxFrames: v })}
              min={3}
              max={20}
              step={1}
            />
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
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
