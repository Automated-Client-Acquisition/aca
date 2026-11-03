import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Volume2, VolumeX, Trash2, Music, Mic, AudioLines, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AudioTrack } from '@/hooks/useVideoEditor';

interface AudioMixerPanelProps {
  audioTracks: AudioTrack[];
  onVolumeChange: (trackId: string, volume: number) => void;
  onRemoveTrack: (trackId: string) => void;
  onAddTrack?: (track: AudioTrack) => void;
}

/** Infer a track icon from the label */
function getTrackIcon(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes('voice') || lower.includes('narrat') || lower.includes('speech')) {
    return Mic;
  }
  if (lower.includes('music') || lower.includes('bg') || lower.includes('background')) {
    return Music;
  }
  return AudioLines;
}

function AddAudioTrackForm({ onAdd }: { onAdd: (track: AudioTrack) => void }) {
  const [label, setLabel] = useState('Background Music');
  const [url, setUrl] = useState('');

  const handleSubmit = () => {
    if (!url.trim()) return;
    onAdd({
      id: `audio-${Date.now()}`,
      src: url.trim(),
      label: label.trim() || 'Audio Track',
      volume: 0.8,
      startFrame: 0,
    });
    setUrl('');
  };

  return (
    <div className="space-y-2 p-3 rounded-lg border border-dashed border-border">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Track label..."
        className="h-8 text-sm"
      />
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Audio URL..."
          className="h-8 text-sm flex-1"
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
        />
        <Button
          variant="cta"
          size="sm"
          className="h-8"
          onClick={handleSubmit}
          disabled={!url.trim()}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}

export function AudioMixerPanel({
  audioTracks,
  onVolumeChange,
  onRemoveTrack,
  onAddTrack,
}: AudioMixerPanelProps) {
  if (audioTracks.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed border-border p-4 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <AudioLines className="h-5 w-5" />
          <span className="text-sm">No audio tracks</span>
          <span className="text-xs">Add background music or voiceover</span>
        </div>
        {onAddTrack && <AddAudioTrackForm onAdd={onAddTrack} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AudioLines className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Audio Mixer</span>
      </div>

      <div className="space-y-2">
        {audioTracks.map((track) => {
          const Icon = getTrackIcon(track.label);
          const isMuted = track.volume === 0;
          const volumePercent = Math.round(track.volume * 100);

          return (
            <div
              key={track.id}
              className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-muted/20 dark:bg-muted/10"
            >
              {/* Track icon */}
              <div className="flex-shrink-0 w-7 h-7 rounded-md bg-muted flex items-center justify-center">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>

              {/* Label */}
              <div className="flex-shrink-0 w-24">
                <span className="text-xs font-medium truncate block">{track.label}</span>
              </div>

              {/* Volume icon button (mute toggle) */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-6 w-6 flex-shrink-0',
                  isMuted && 'text-muted-foreground',
                )}
                onClick={() => onVolumeChange(track.id, isMuted ? 0.8 : 0)}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? (
                  <VolumeX className="h-3.5 w-3.5" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" />
                )}
              </Button>

              {/* Volume slider */}
              <div className="flex-1 flex items-center gap-2">
                <Slider
                  value={[track.volume]}
                  onValueChange={([v]) => onVolumeChange(track.id, v)}
                  min={0}
                  max={1}
                  step={0.01}
                  className="flex-1"
                />
                <span className="text-[10px] text-muted-foreground w-8 text-right tabular-nums">
                  {volumePercent}%
                </span>
              </div>

              {/* Remove */}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => onRemoveTrack(track.id)}
                title="Remove track"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>

      {onAddTrack && <AddAudioTrackForm onAdd={onAddTrack} />}
    </div>
  );
}
